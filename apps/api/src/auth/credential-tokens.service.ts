import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { readCollegeSettings } from '@campusos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TokenService } from './token.service';
import { OnboardingService } from './onboarding.service';
import type { AuthenticatedUser } from '../access/authenticated-user';

export const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours
export const RESET_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface IssuedCredentialLink {
  url: string; // path-only; the web origin prefixes it
  expiresAt: string;
}

function genericInvalid(): BadRequestException {
  // Never reveal whether the token or the user exists (W2 requirement).
  return new BadRequestException({
    code: 'INVALID_TOKEN',
    message: 'This link is invalid or has expired. Request a new one.',
  });
}

/**
 * Invitation / password-reset tokens (M10-W2).
 *  - 256-bit random tokens; only the SHA-256 hash is stored, never the raw
 *    value, and the raw value is never logged.
 *  - One-time (atomic claim) and expiring (INVITE 48h, RESET 24h).
 *  - Issuing a new token revokes the user's previous active tokens of the
 *    same purpose.
 */
@Injectable()
export class CredentialTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly onboarding: OnboardingService,
  ) {}

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** A random password hash nobody can ever guess or use to log in. */
  async unusablePasswordHash(): Promise<string> {
    return argon2.hash(randomBytes(32).toString('hex'), {
      type: argon2.argon2id,
    });
  }

  async issue(
    userId: string,
    purpose: 'INVITE' | 'RESET',
    issuedBy: { id: string; collegeId: string } | null,
    tx?: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
  ): Promise<IssuedCredentialLink> {
    const db = tx ?? this.prisma;
    const raw = randomBytes(32).toString('hex');
    const expiresAt = new Date(
      Date.now() + (purpose === 'INVITE' ? INVITE_TTL_MS : RESET_TTL_MS),
    );

    // Previous active tokens of the same purpose stop working immediately.
    await db.credentialToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    });
    await db.credentialToken.create({
      data: {
        userId,
        tokenHash: this.hash(raw),
        purpose,
        expiresAt,
        createdById: issuedBy?.id ?? null,
      },
    });

    if (issuedBy) {
      await this.audit.log({
        collegeId: issuedBy.collegeId,
        actorId: issuedBy.id,
        action:
          purpose === 'INVITE' ? 'auth.invite_issued' : 'auth.reset_issued',
        targetType: 'User',
        targetId: userId,
      });
    }

    const suffix = purpose === 'RESET' ? '&purpose=reset' : '';
    return {
      url: `/accept-invite?token=${raw}${suffix}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Validated, unconsumed token lookup (shared by all acceptance paths). */
  async lookupValid(rawToken: string, purpose: 'INVITE' | 'RESET') {
    const record = await this.prisma.credentialToken.findUnique({
      where: { tokenHash: this.hash(rawToken) },
      include: {
        user: {
          select: {
            id: true,
            collegeId: true,
            status: true,
            role: true,
            firstName: true,
            college: { select: { name: true, settings: true } },
            studentProfile: { select: { id: true } },
          },
        },
      },
    });
    if (
      !record ||
      record.purpose !== purpose ||
      record.usedAt !== null ||
      record.expiresAt.getTime() <= Date.now() ||
      record.user.status !== 'ACTIVE'
    ) {
      throw genericInvalid();
    }
    return record;
  }

  /**
   * M11-W4 — acceptance methods offered for an invite, driven by the
   * invited user's college settings (never by client input):
   *   off      → password
   *   additive → both (google shown only when the feature is configured)
   *   required → google (students); non-students always use password
   */
  inviteMode(
    record: Awaited<ReturnType<CredentialTokensService['lookupValid']>>,
    googleConfigured: boolean,
  ): 'password' | 'google' | 'both' {
    if (!record.user.studentProfile || !googleConfigured) return 'password';
    const settings = readCollegeSettings(record.user.college.settings);
    if (settings.googleAuth === 'required') return 'google';
    if (settings.googleAuth === 'additive') return 'both';
    return 'password';
  }

  /**
   * Claims a token and sets the password. The whole acceptance is one
   * transaction (M11-W4): the token is only consumed if every side effect
   * (password, verification, supersession) commits.
   */
  async accept(
    rawToken: string,
    purpose: 'INVITE' | 'RESET',
    password: string,
    googleConfigured = false,
  ): Promise<{ accepted: true }> {
    const record = await this.lookupValid(rawToken, purpose);

    // Google-only colleges: student invites cannot be activated with a
    // password (server-side enforcement, not just UI). The token stays
    // valid for the Google path.
    if (
      purpose === 'INVITE' &&
      this.inviteMode(record, googleConfigured) === 'google'
    ) {
      throw new ForbiddenException({
        code: 'GOOGLE_SIGNIN_REQUIRED',
        message: 'Use Google sign-in to activate this account',
      });
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const onboarding = await this.prisma.$transaction(async (tx) => {
      // Atomic one-time claim — a concurrent request loses this race, and
      // a failure later in the transaction un-consumes the token.
      const claimed = await tx.credentialToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw genericInvalid();
      }
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash, mustChangePassword: false },
      });
      // M11-W4: invitation possession is admin-provisioned identity proof —
      // student accounts become VERIFIED and hold their identity slot.
      if (purpose === 'INVITE') {
        return this.onboarding.applyVerification(
          tx,
          record.userId,
          record.createdById,
        );
      }
      return null;
    });

    // Any existing sessions die with the old credential.
    await this.tokens.revokeAllExceptFamily(record.userId, null);

    await this.audit.log({
      collegeId: record.user.collegeId,
      actorId: record.userId,
      action:
        purpose === 'INVITE' ? 'auth.invite_accepted' : 'auth.reset_accepted',
      targetType: 'User',
      targetId: record.userId,
      metadata: purpose === 'INVITE' ? { method: 'password' } : undefined,
    });
    if (onboarding) {
      await this.onboarding.announce(record.user, onboarding, 'invitation');
    }
    return { accepted: true };
  }

  /** Admin-issued reset link; the target must belong to the caller's college. */
  async issueResetLink(
    admin: AuthenticatedUser,
    targetUserId: string,
  ): Promise<IssuedCredentialLink> {
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, collegeId: admin.collegeId },
      select: { id: true, status: true },
    });
    if (!target) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'User not found',
      });
    }
    if (target.status !== 'ACTIVE') {
      throw new ForbiddenException({
        code: 'USER_INACTIVE',
        message: 'Reset links can only be issued for active accounts',
      });
    }
    return this.issue(targetUserId, 'RESET', admin);
  }
}
