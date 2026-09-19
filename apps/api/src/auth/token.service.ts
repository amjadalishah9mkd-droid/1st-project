import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface AccessTokenPayload {
  sub: string;
  role: string;
  collegeId: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string; // raw value — only ever leaves as an httpOnly cookie
  refreshExpiresAt: Date;
}

const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * TokenService (Blueprint §9).
 *  - Access JWT: 15 min, payload restricted to { sub, role, collegeId }.
 *  - Refresh token: opaque 256-bit random value; only its SHA-256 hash is
 *    stored. Tokens belong to a family; each refresh rotates the token and
 *    revokes the previous one. Presenting a revoked token revokes the entire
 *    family (reuse detection).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  signAccessToken(payload: AccessTokenPayload): string {
    // Payload contains ONLY sub/role/collegeId — never permissions.
    return this.jwt.sign(
      { sub: payload.sub, role: payload.role, collegeId: payload.collegeId },
      { expiresIn: ACCESS_TOKEN_TTL },
    );
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    return this.jwt.verify<AccessTokenPayload>(token);
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** Start a brand-new refresh-token family (login). */
  async issueFamily(
    user: { id: string; role: string; collegeId: string },
    meta: { userAgent?: string; ip?: string },
  ): Promise<IssuedTokens> {
    const familyId = randomUUID();
    return this.createToken(user, familyId, meta);
  }

  private async createToken(
    user: { id: string; role: string; collegeId: string },
    familyId: string,
    meta: { userAgent?: string; ip?: string },
  ): Promise<IssuedTokens> {
    const raw = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hash(raw),
        familyId,
        expiresAt,
        userAgent: meta.userAgent?.slice(0, 255),
        ip: meta.ip?.slice(0, 64),
      },
    });

    return {
      accessToken: this.signAccessToken({
        sub: user.id,
        role: user.role,
        collegeId: user.collegeId,
      }),
      refreshToken: raw,
      refreshExpiresAt: expiresAt,
    };
  }

  /**
   * Rotate a refresh token. Returns fresh tokens or throws 401.
   * Reuse of a revoked token revokes the whole family and is audited.
   * User status is re-checked: suspended/archived users cannot refresh.
   */
  async rotate(
    rawToken: string,
    meta: { userAgent?: string; ip?: string },
  ): Promise<{ tokens: IssuedTokens; userId: string }> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(rawToken) },
      include: {
        user: {
          select: { id: true, role: true, collegeId: true, status: true },
        },
      },
    });

    if (!record) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid session',
      });
    }

    // Reuse detection: a revoked token is being replayed → kill the family.
    if (record.revokedAt) {
      await this.revokeFamily(record.familyId);
      await this.audit.log({
        collegeId: record.user.collegeId,
        actorId: record.userId,
        action: 'auth.token_family_revoked',
        targetType: 'RefreshTokenFamily',
        targetId: record.familyId,
        metadata: { reason: 'refresh_token_reuse_detected' },
      });
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid session',
      });
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Session expired',
      });
    }

    // Suspension takes effect at refresh time (Blueprint §9).
    if (record.user.status !== 'ACTIVE') {
      await this.revokeFamily(record.familyId);
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Account is not active',
      });
    }

    // Rotation: revoke the presented token, mint the successor in-family.
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    const tokens = await this.createToken(record.user, record.familyId, meta);
    return { tokens, userId: record.userId };
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revoke the family owning a raw token (logout). Silent when unknown. */
  async revokeByRawToken(rawToken: string): Promise<string | null> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(rawToken) },
      select: { familyId: true, userId: true },
    });
    if (!record) return null;
    await this.revokeFamily(record.familyId);
    return record.userId;
  }

  /** Revoke every session of a user except one family (password change). */
  async revokeAllExceptFamily(
    userId: string,
    keepFamilyId: string | null,
  ): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(keepFamilyId ? { familyId: { not: keepFamilyId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  async familyIdForRawToken(rawToken: string): Promise<string | null> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(rawToken) },
      select: { familyId: true },
    });
    return record?.familyId ?? null;
  }
}
