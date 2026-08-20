import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import type {
  ChangePasswordInput,
  LoginInput,
  MePayload,
  PermissionGrant,
} from '@campusos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService, IssuedTokens } from './token.service';
import { LoginRateLimiterService } from './login-rate-limiter.service';
import { AuditService } from '../audit/audit.service';
import { PolicyService } from '../access/policy.service';
import type { AuthenticatedUser } from '../access/authenticated-user';

interface RequestMeta {
  ip: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly rateLimiter: LoginRateLimiterService,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
  ) {}

  private invalidCredentials(): UnauthorizedException {
    // Generic message — no user enumeration (Blueprint §9).
    return new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  }

  async login(
    input: LoginInput,
    meta: RequestMeta,
  ): Promise<{ tokens: IssuedTokens; me: MePayload }> {
    this.rateLimiter.assertAllowed(meta.ip, input.email);

    const user = await this.prisma.user.findFirst({
      where: { email: input.email },
    });

    const passwordValid =
      user !== null &&
      (await argon2.verify(user.passwordHash, input.password).catch(() => false));

    if (!user || !passwordValid || user.status !== 'ACTIVE') {
      this.rateLimiter.recordFailure(meta.ip, input.email);
      if (user) {
        await this.audit.log({
          collegeId: user.collegeId,
          actorId: user.id,
          action: 'auth.login.failure',
          targetType: 'User',
          targetId: user.id,
          metadata: {
            reason: !passwordValid ? 'bad_password' : 'inactive_account',
          },
        });
      }
      throw this.invalidCredentials();
    }

    this.rateLimiter.recordSuccess(input.email);

    const tokens = await this.tokens.issueFamily(user, meta);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'auth.login.success',
      targetType: 'User',
      targetId: user.id,
    });

    return { tokens, me: await this.buildMePayload(user.id) };
  }

  async refresh(
    rawRefreshToken: string,
    meta: RequestMeta,
  ): Promise<{ tokens: IssuedTokens; me: MePayload }> {
    const { tokens, userId } = await this.tokens.rotate(rawRefreshToken, meta);
    return { tokens, me: await this.buildMePayload(userId) };
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    const userId = await this.tokens.revokeByRawToken(rawRefreshToken);
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { collegeId: true },
      });
      if (user) {
        await this.audit.log({
          collegeId: user.collegeId,
          actorId: userId,
          action: 'auth.logout',
          targetType: 'User',
          targetId: userId,
        });
      }
    }
  }

  async changePassword(
    user: AuthenticatedUser,
    input: ChangePasswordInput,
    rawRefreshToken: string | undefined,
  ): Promise<void> {
    const record = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true, collegeId: true },
    });
    if (!record) {
      throw this.invalidCredentials();
    }

    const currentValid = await argon2
      .verify(record.passwordHash, input.currentPassword)
      .catch(() => false);
    if (!currentValid) {
      throw new BadRequestException({
        code: 'INVALID_CURRENT_PASSWORD',
        message: 'The current password is incorrect',
      });
    }

    const passwordHash = await argon2.hash(input.newPassword, {
      type: argon2.argon2id,
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
    });

    // Revoke every other session; the current family stays valid.
    const keepFamilyId = rawRefreshToken
      ? await this.tokens.familyIdForRawToken(rawRefreshToken)
      : null;
    await this.tokens.revokeAllExceptFamily(user.id, keepFamilyId);

    await this.audit.log({
      collegeId: record.collegeId,
      actorId: user.id,
      action: 'auth.password_changed',
      targetType: 'User',
      targetId: user.id,
    });
  }

  /**
   * /me payload (Blueprint §5 — permissions resolved from the database on
   * every request, never read from the JWT).
   */
  async buildMePayload(userId: string): Promise<MePayload> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        college: { select: { id: true, name: true, code: true } },
        teacherProfile: {
          include: { department: { select: { id: true, name: true } } },
        },
        studentProfile: {
          include: { department: { select: { id: true, name: true } } },
        },
      },
    });

    const [grants, unreadNotifications] = await Promise.all([
      this.policy.grantsForRole(user.role),
      this.prisma.notification.count({
        where: { userId: user.id, readAt: null },
      }),
    ]);

    return {
      id: user.id,
      collegeId: user.collegeId,
      email: user.email,
      role: user.role,
      status: user.status,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      mustChangePassword: user.mustChangePassword,
      permissions: grants as PermissionGrant[],
      college: user.college,
      teacherProfile: user.teacherProfile
        ? {
            id: user.teacherProfile.id,
            employeeNo: user.teacherProfile.employeeNo,
            designation: user.teacherProfile.designation,
            departmentId: user.teacherProfile.department.id,
            departmentName: user.teacherProfile.department.name,
          }
        : null,
      studentProfile: user.studentProfile
        ? {
            id: user.studentProfile.id,
            admissionNo: user.studentProfile.admissionNo,
            rollNo: user.studentProfile.rollNo,
            batch: user.studentProfile.batch,
            departmentId: user.studentProfile.department.id,
            departmentName: user.studentProfile.department.name,
            status: user.studentProfile.status,
          }
        : null,
      counters: { unreadNotifications },
    };
  }
}
