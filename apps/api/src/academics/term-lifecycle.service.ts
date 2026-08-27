import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../access/authenticated-user';

/**
 * M17-W1 — term lifecycle (docs/M17_TERM_LIFECYCLE_DESIGN.md §§7,9,17).
 *
 *   ACTIVE ──close (typed confirmation, not current)──▶ CLOSED
 *   CLOSED ──reopen (typed confirmation)──▶ ACTIVE
 *
 * Invariants:
 *  - Both transitions run in ONE transaction: `SELECT … FOR UPDATE` on the
 *    Term row, authoritative re-read of status/isCurrent under the lock,
 *    CAS `updateMany({ where: { status: <expected> } })`, audit in the
 *    same transaction. Concurrent transitions collapse to exactly one
 *    winner; the loser gets 409 INVALID_TRANSITION.
 *  - D-3: the CURRENT term can never be closed (TERM_IS_CURRENT), checked
 *    against the LOCKED row — never a preflight read.
 *  - Typed confirmation (rollover pattern): the client must send the
 *    exact term label; validated server-side.
 *  - Tenancy: findFirst({ id, collegeId }) before anything; a foreign or
 *    missing term is an indistinguishable 404.
 *  - Lock ordering (W2 contract): Term BEFORE Invoice, always.
 *  - `assertTermOpen` is THE reusable guard for W2 enforcement: it runs
 *    AFTER authorization, inside the caller's transaction where one
 *    exists, taking FOR SHARE on the Term row so writes serialize
 *    against a concurrent close (which takes FOR UPDATE).
 */

type Tx = Prisma.TransactionClient;

@Injectable()
export class TermLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Reusable CLOSED-term guard (W2 wires the call sites). Term identity
   * must be resolved SERVER-side by the caller (section/exam/structure →
   * termId); collegeId always comes from the authenticated user.
   * 404 for missing/foreign, 409 TERM_CLOSED for closed, returns for
   * ACTIVE. Runs inside the caller's transaction when provided.
   */
  async assertTermOpen(
    tx: Tx | PrismaService,
    collegeId: string,
    termId: string,
  ): Promise<void> {
    // FOR SHARE: serializes against a concurrent close (FOR UPDATE)
    // without writers blocking each other.
    const rows = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT "status" FROM "Term"
      WHERE id = ${termId} AND "collegeId" = ${collegeId}
      FOR SHARE`;
    if (rows.length === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Term not found' });
    }
    if (rows[0].status === 'CLOSED') {
      throw new ConflictException({
        code: 'TERM_CLOSED',
        message: 'This term is closed — its records are read-only',
      });
    }
  }

  async close(
    user: AuthenticatedUser,
    termId: string,
    confirmLabel: string,
  ): Promise<{ id: string; label: string; status: 'ACTIVE' | 'CLOSED' }> {
    return this.transition(user, termId, confirmLabel, 'close');
  }

  async reopen(
    user: AuthenticatedUser,
    termId: string,
    confirmLabel: string,
  ): Promise<{ id: string; label: string; status: 'ACTIVE' | 'CLOSED' }> {
    return this.transition(user, termId, confirmLabel, 'reopen');
  }

  /**
   * Server-side close used by the rollover D-4 hook: the caller already
   * proved intent through the rollover's own typed confirmation plus an
   * EXPLICIT closeSourceTerm flag, and the label is supplied from
   * authoritative server state — never the browser.
   */
  async closeFromRollover(
    user: AuthenticatedUser,
    termId: string,
  ): Promise<{ closed: boolean; errorCode?: string }> {
    const term = await this.prisma.term.findFirst({
      where: { id: termId, collegeId: user.collegeId },
      select: { label: true },
    });
    if (!term) return { closed: false, errorCode: 'NOT_FOUND' };
    try {
      await this.transition(user, termId, term.label, 'close');
      return { closed: true };
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'getResponse' in error
          ? ((error as { getResponse(): { code?: string } }).getResponse().code ??
            'CLOSE_FAILED')
          : 'CLOSE_FAILED';
      return { closed: false, errorCode: code };
    }
  }

  private async transition(
    user: AuthenticatedUser,
    termId: string,
    confirmLabel: string,
    kind: 'close' | 'reopen',
  ): Promise<{ id: string; label: string; status: 'ACTIVE' | 'CLOSED' }> {
    // Tenancy gate first — a foreign term must be indistinguishable from
    // a nonexistent one, and must never leak lifecycle state.
    const term = await this.prisma.term.findFirst({
      where: { id: termId, collegeId: user.collegeId },
      select: { id: true, label: true },
    });
    if (!term) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Term not found' });
    }
    // Typed confirmation — server-authoritative (M15 rollover pattern).
    if (confirmLabel !== term.label) {
      throw new BadRequestException({
        code: 'CONFIRMATION_MISMATCH',
        message: 'Type the exact term label to confirm',
      });
    }

    const from = kind === 'close' ? 'ACTIVE' : 'CLOSED';
    const to = kind === 'close' ? 'CLOSED' : 'ACTIVE';

    const result = await this.prisma.$transaction(async (tx) => {
      // Row lock: every lifecycle decision below reads AUTHORITATIVE
      // locked state (Term before Invoice — the W2 lock-order contract).
      const locked = await tx.$queryRaw<
        Array<{ status: string; isCurrent: boolean }>
      >`SELECT "status", "isCurrent" FROM "Term" WHERE id = ${termId} FOR UPDATE`;
      if (locked.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Term not found' });
      }
      // D-3 under the lock: the current term can never be closed.
      if (kind === 'close' && locked[0].isCurrent) {
        throw new BadRequestException({
          code: 'TERM_IS_CURRENT',
          message: 'The current term cannot be closed — set another term current first',
        });
      }
      // CAS: exactly one concurrent transition wins.
      const claimed = await tx.term.updateMany({
        where: { id: termId, collegeId: user.collegeId, status: from },
        data: { status: to },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message:
            kind === 'close'
              ? 'Only an active term can be closed'
              : 'Only a closed term can be reopened',
        });
      }
      // Audit inside the transaction: the row exists iff the transition
      // committed — replays/losers can never produce a duplicate.
      await this.audit.log(
        {
          collegeId: user.collegeId,
          actorId: user.id,
          action: kind === 'close' ? 'terms.closed' : 'terms.reopened',
          targetType: 'Term',
          targetId: termId,
          metadata: { label: term.label },
        },
        tx,
      );
      return { id: termId, label: term.label, status: to as 'ACTIVE' | 'CLOSED' };
    });
    return result;
  }
}
