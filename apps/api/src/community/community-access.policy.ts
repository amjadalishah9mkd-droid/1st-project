import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../access/policy.service';
import type { AuthenticatedUser } from '../access/authenticated-user';

/**
 * CommunityAccessPolicy (Blueprint §11) — the single participation gate:
 *   permission grant AND User.status=ACTIVE AND no active SUSPEND_COMMUNITY
 *   moderation action (unexpired and not lifted).
 * Used by every community write endpoint.
 */
@Injectable()
export class CommunityAccessPolicy {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  async canParticipate(user: AuthenticatedUser): Promise<boolean> {
    if (user.status !== 'ACTIVE') return false;
    const scope = await this.policy.scopeFor(user, 'community.participate');
    if (!scope) return false;

    const suspension = await this.prisma.moderationAction.findFirst({
      where: {
        targetUserId: user.id,
        action: 'SUSPEND_COMMUNITY',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!suspension) return true;
    const lifted = await this.prisma.moderationAction.findFirst({
      where: {
        targetUserId: user.id,
        action: 'LIFT_SUSPENSION',
        createdAt: { gt: suspension.createdAt },
      },
    });
    return lifted !== null;
  }

  async assertParticipant(user: AuthenticatedUser): Promise<void> {
    if (!(await this.canParticipate(user))) {
      throw new ForbiddenException({
        code: 'COMMUNITY_SUSPENDED',
        message: 'You cannot participate in the community right now',
      });
    }
  }
}
