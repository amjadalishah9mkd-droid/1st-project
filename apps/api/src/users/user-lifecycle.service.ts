import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ROLE_PERMISSION_MATRIX } from '@campusos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../access/authenticated-user';

/**
 * M21-W1 — account lifecycle administration (O-1…O-4, O-7).
 *
 * UserStatus was ALREADY enforced at every boundary (login, JWT guard,
 * refresh, Google, credential tokens, PolicyService) — this service only
 * adds the administrative lever. Transitions (O-3):
 *
 *   ACTIVE  → SUSPENDED   (suspend, reason required)
 *   SUSPENDED → ACTIVE    (reactivate)
 *   ACTIVE|SUSPENDED → ARCHIVED (archive, reason required, TERMINAL)
 *
 * Safety:
 *  - fees nothing to roles: the "usable admin" set is derived from the
 *    permission MATRIX data (roles granted users.manage), never from
 *    role-name conditionals;
 *  - self-changes are rejected (server actor identity only);
 *  - last-admin protection is transactional and race-safe: a per-college
 *    advisory xact lock serializes lifecycle transitions, so two
 *    concurrent suspensions of the two remaining admins cannot both pass
 *    the count;
 *  - CAS updateMany on the expected from-status makes replays/races lose
 *    with 409 INVALID_TRANSITION;
 *  - all refresh-token families are revoked in the SAME transaction when
 *    an account leaves ACTIVE (defense in depth — the guard and refresh
 *    path already re-read status per request);
 *  - audit (users.suspended / users.reactivated / users.archived) is
 *    written inside the transaction with the server-derived actor.
 *
 * O-7: StudentProfile/TeacherProfile academic state is deliberately NOT
 * touched — account status and academic status are separate concerns.
 */
@Injectable()
export class UserLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Roles that can administer accounts, derived from matrix DATA. */
  private static readonly MANAGER_ROLES = Array.from(
    new Set(
      ROLE_PERMISSION_MATRIX.filter(
        (grant) => grant.permission === 'users.manage',
      ).map((grant) => grant.role),
    ),
  );

  suspend(actor: AuthenticatedUser, targetId: string, reason: string) {
    return this.transition(actor, targetId, {
      action: 'suspend',
      from: ['ACTIVE'],
      to: 'SUSPENDED',
      reason,
      revokeSessions: true,
      auditAction: 'users.suspended',
    });
  }

  reactivate(actor: AuthenticatedUser, targetId: string) {
    return this.transition(actor, targetId, {
      action: 'reactivate',
      from: ['SUSPENDED'],
      to: 'ACTIVE',
      reason: null,
      revokeSessions: false,
      auditAction: 'users.reactivated',
    });
  }

  archive(actor: AuthenticatedUser, targetId: string, reason: string) {
    return this.transition(actor, targetId, {
      action: 'archive',
      from: ['ACTIVE', 'SUSPENDED'],
      to: 'ARCHIVED',
      reason,
      revokeSessions: true,
      auditAction: 'users.archived',
    });
  }

  private async transition(
    actor: AuthenticatedUser,
    targetId: string,
    spec: {
      action: 'suspend' | 'reactivate' | 'archive';
      from: Array<'ACTIVE' | 'SUSPENDED'>;
      to: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
      reason: string | null;
      revokeSessions: boolean;
      auditAction: string;
    },
  ) {
    // O-4: the actor can never lifecycle their own account. Actor identity
    // is the server-side authenticated user — request bodies carry nothing.
    if (targetId === actor.id) {
      throw new BadRequestException({
        code: 'CANNOT_MODIFY_SELF',
        message: 'You cannot change the status of your own account',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      // Serialize ALL lifecycle transitions per college: makes the
      // last-admin count race-proof (two concurrent suspends of the two
      // remaining admins execute strictly one-after-another).
      await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`${actor.collegeId}:user-lifecycle`}))`;

      // Tenant gate: a foreign or nonexistent target is the same 404.
      const target = await tx.user.findFirst({
        where: { id: targetId, collegeId: actor.collegeId },
        select: { id: true, role: true, status: true },
      });
      if (!target) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'User not found',
        });
      }
      if (target.status === 'ARCHIVED') {
        // O-3: terminal — indistinguishable transition rules for every verb.
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: 'Archived accounts are permanent and cannot be changed',
        });
      }

      // O-4: never remove the last usable administrator. "Usable admin" =
      // ACTIVE account whose role is granted users.manage by the matrix.
      if (
        spec.to !== 'ACTIVE' &&
        target.status === 'ACTIVE' &&
        UserLifecycleService.MANAGER_ROLES.includes(target.role)
      ) {
        const otherAdmins = await tx.user.count({
          where: {
            collegeId: actor.collegeId,
            status: 'ACTIVE',
            role: { in: UserLifecycleService.MANAGER_ROLES },
            id: { not: target.id },
          },
        });
        if (otherAdmins === 0) {
          throw new ConflictException({
            code: 'LAST_ADMIN',
            message:
              'This is the last active administrator account in the college',
          });
        }
      }

      // CAS: exactly one transition wins; stale/duplicate attempts 409.
      const claimed = await tx.user.updateMany({
        where: { id: target.id, status: { in: spec.from } },
        data: {
          status: spec.to,
          statusReason: spec.reason,
          statusChangedAt: new Date(),
          statusChangedById: actor.id,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: `This account cannot be ${
            spec.action === 'reactivate' ? 'reactivated' : `${spec.action}d`
          } from its current status`,
        });
      }

      if (spec.revokeSessions) {
        // Defense in depth: the guard/refresh path already re-read status,
        // but leaving ACTIVE also revokes every refresh-token family NOW,
        // in the same transaction.
        await tx.refreshToken.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      await this.audit.log(
        {
          collegeId: actor.collegeId,
          actorId: actor.id,
          action: spec.auditAction,
          targetType: 'User',
          targetId: target.id,
          metadata: spec.reason ? { reason: spec.reason } : {},
        },
        tx,
      );

      const updated = await tx.user.findUniqueOrThrow({
        where: { id: target.id },
        select: {
          id: true,
          status: true,
          statusReason: true,
          statusChangedAt: true,
        },
      });
      return {
        id: updated.id,
        status: updated.status,
        statusReason: updated.statusReason,
        statusChangedAt: updated.statusChangedAt?.toISOString() ?? null,
      };
    });
  }
}
