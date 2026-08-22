import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TokenService } from './token.service';
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

  /**
   * Claims a token and sets the password. The claim is atomic
   * (updateMany over usedAt=null) so concurrent submissions cannot both win.
   */
  async accept(
    rawToken: string,
    purpose: 'INVITE' | 'RESET',
    password: string,
  ): Promise<{ accepted: true }> {
    const record = await this.prisma.credentialToken.findUnique({
      where: { tokenHash: this.hash(rawToken) },
      include: { user: { select: { id: true, collegeId: true, status: true } } },
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

    // Atomic one-time claim — a concurrent request loses this race.
    const claimed = await this.prisma.credentialToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw genericInvalid();
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash, mustChangePassword: false },
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
    });
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
