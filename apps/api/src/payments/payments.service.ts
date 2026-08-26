import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PaymentAttemptStatus } from '@prisma/client';
import type {
  PageMeta,
  PaginationQuery,
  ReconciliationAttemptItem,
  UnmatchedGatewayEventItem,
} from '@campusos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../access/policy.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.module';
import { pageArgs, pageMeta } from '../common/pagination/pagination';
import type { AuthenticatedUser } from '../access/authenticated-user';
import {
  PAYMENT_GATEWAY,
  type PaymentGatewayAdapter,
} from './gateway.adapter';

/**
 * M14-W1 — secure settlement core for online payments.
 *
 * Invariants (Blueprint + M14-H1 decisions):
 *  - `Payment` remains settled money ONLY. The in-flight gateway lifecycle
 *    lives on `PaymentAttempt`; a verified confirmation *materializes* a
 *    normal Payment row and nothing else does.
 *  - The payable amount is computed server-side from database state at
 *    initiation (full outstanding balance — decision #3) and frozen on the
 *    attempt. Nothing from a browser or webhook payload ever sets amounts.
 *  - Every state transition that can settle money runs inside a
 *    transaction that first takes a row lock on the invoice
 *    (`SELECT … FOR UPDATE`), then re-reads balances, then performs a
 *    compare-and-swap on the attempt status — replays and races collapse
 *    into exactly one settlement.
 *  - Tenancy: attempts carry their own collegeId belt; webhook-side code
 *    (W3) resolves attempts from stored state only.
 *
 * The gateway adapter (Safepay) and HTTP surfaces arrive in W2/W3 — this
 * service is deliberately transport-free so those layers stay thin.
 */

/** Attempts older than this without confirmation are considered dead. */
export const ATTEMPT_TTL_MS = 60 * 60 * 1000; // 1 hour

const forbidden = () =>
  new ForbiddenException({
    code: 'FORBIDDEN',
    message: 'You do not have permission to perform this action',
  });

export interface SettlementInput {
  provider: string;
  providerRef: string;
  /** Amount as reported by the verified gateway confirmation. */
  amount: string;
  currency: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayAdapter,
  ) {}

  /**
   * M14-W5 — emit the student-facing outcome event for an attempt.
   * Called AFTER the settlement/failure transaction commits; notification
   * failures can never touch payment state.
   */
  async notifyOutcome(
    attemptId: string,
    type: 'payment.succeeded' | 'payment.failed',
  ): Promise<void> {
    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { id: attemptId },
      include: {
        invoice: { include: { student: { select: { userId: true } } } },
      },
    });
    if (!attempt) return;
    this.events.emit({
      type,
      studentUserId: attempt.invoice.student.userId,
      invoiceId: attempt.invoiceId,
      attemptId: attempt.id,
      amount: attempt.amount.toString(),
      invoiceNo: attempt.invoice.invoiceNo,
    });
  }

  /**
   * M14-W5 — reconciliation list (fees.manage, resolved ALL scope only).
   * Tenancy is the authenticated admin's collegeId — never client input.
   */
  async listReconciliation(
    user: AuthenticatedUser,
    query: PaginationQuery & { status?: string; provider?: string; invoiceNo?: string },
  ): Promise<{ data: ReconciliationAttemptItem[]; meta: PageMeta }> {
    await this.requireManageAll(user);
    const where = {
      collegeId: user.collegeId,
      ...(query.status
        ? { status: query.status as 'PENDING' }
        : {}),
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.invoiceNo
        ? { invoice: { invoiceNo: { contains: query.invoiceNo, mode: 'insensitive' as const } } }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.paymentAttempt.findMany({
        where,
        include: {
          invoice: {
            select: {
              invoiceNo: true,
              student: {
                select: {
                  rollNo: true,
                  user: { select: { firstName: true, lastName: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        ...pageArgs(query),
      }),
      this.prisma.paymentAttempt.count({ where }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        invoiceId: row.invoiceId,
        invoiceNo: row.invoice.invoiceNo,
        studentName: `${row.invoice.student.user.firstName} ${row.invoice.student.user.lastName}`,
        rollNo: row.invoice.student.rollNo,
        amount: row.amount.toString(),
        currency: row.currency,
        provider: row.provider,
        providerRef: row.providerRef,
        status: row.status,
        overpaid: row.overpaid,
        failureCode: row.failureCode,
        createdAt: row.createdAt.toISOString(),
        confirmedAt: row.confirmedAt?.toISOString() ?? null,
      })),
      meta: pageMeta(query, total),
    };
  }

  /**
   * M14-W5 — unmatched gateway deliveries (UNMATCHED_* outcomes). These
   * are tenant-unattributable BY DESIGN (the tracker matched no attempt),
   * carry no PII and no payload bodies — only provider/eventId/outcome.
   */
  async listUnmatchedEvents(
    user: AuthenticatedUser,
  ): Promise<UnmatchedGatewayEventItem[]> {
    await this.requireManageAll(user);
    const rows = await this.prisma.gatewayEvent.findMany({
      where: { outcome: { startsWith: 'UNMATCHED_' } },
      orderBy: { receivedAt: 'desc' },
      take: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      eventId: row.eventId,
      outcome: row.outcome,
      receivedAt: row.receivedAt.toISOString(),
    }));
  }

  /**
   * M14-W5 — admin "verify with gateway". The browser only requests
   * verification; the server asks the adapter and routes the answer
   * through the SAME settlement/failure core as webhooks. Terminal
   * attempts are returned as-is (never resurrected).
   */
  async reconcileVerify(user: AuthenticatedUser, attemptId: string) {
    await this.requireManageAll(user);
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: { id: attemptId, collegeId: user.collegeId },
    });
    if (!attempt) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Payment attempt not found',
      });
    }
    let outcome = 'NO_ACTION';
    if (attempt.status === 'PENDING' && attempt.providerRef !== null) {
      const verification = await this.gateway.verifyPayment(attempt.providerRef);
      if (verification.state === 'PAID') {
        try {
          const settled = await this.settleAttempt(attempt.id, {
            provider: this.gateway.provider,
            providerRef: attempt.providerRef,
            amount: verification.amount,
            currency: verification.currency,
          });
          outcome = settled.justSettled ? 'SETTLED' : 'ALREADY_SETTLED';
          if (settled.justSettled) {
            await this.notifyOutcome(attempt.id, 'payment.succeeded');
          }
        } catch {
          outcome = 'REJECTED'; // AMOUNT_MISMATCH persisted FAILED by the core
          const after = await this.prisma.paymentAttempt.findUnique({
            where: { id: attempt.id },
          });
          if (after?.failureCode === 'AMOUNT_MISMATCH') {
            await this.notifyOutcome(attempt.id, 'payment.failed');
          }
        }
      } else if (verification.state === 'FAILED') {
        const failed = await this.failAttempt(
          attempt.id,
          'PROVIDER_REPORTED_FAILURE',
        );
        outcome = 'FAILED';
        if (failed.justFailed) {
          await this.notifyOutcome(attempt.id, 'payment.failed');
        }
      } else {
        outcome = 'STILL_PENDING';
      }
    }
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'payments.reconciliation_verified',
      targetType: 'PaymentAttempt',
      targetId: attemptId,
      metadata: { provider: attempt.provider, outcome },
    });
    const current = await this.prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    return {
      attemptId: current.id,
      invoiceId: current.invoiceId,
      status: current.status,
      overpaid: current.overpaid,
      outcome,
    };
  }

  /** fees.manage must resolve to ALL — reconciliation is a staff surface. */
  private async requireManageAll(user: AuthenticatedUser): Promise<void> {
    const scope = await this.policy.scopeFor(user, 'fees.manage');
    if (scope !== 'ALL') throw forbidden();
  }

  /**
   * Create a payment attempt for the caller's own invoice (OWN scope).
   * The frozen amount is ALWAYS the full outstanding balance (decision #3).
   * W2 wraps this with the gateway-session creation.
   */
  async createAttempt(
    user: AuthenticatedUser,
    invoiceId: string,
    provider: string,
  ) {
    const scope = await this.policy.scopeFor(user, 'payments.initiate');
    if (!scope) throw forbidden();

    return this.prisma.$transaction(async (tx) => {
      // Row lock: initiation, settlement and manual recording all serialize
      // on the invoice row, so balances can never be computed from stale
      // reads concurrently.
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
      const invoice = await tx.invoice.findFirst({
        where: {
          id: invoiceId,
          collegeId: user.collegeId,
          // OWN scope pins the invoice to the caller; ALL (staff) may
          // initiate on any same-college invoice (future assisted flows).
          ...(scope === 'OWN' ? { student: { userId: user.id } } : {}),
        },
        include: { payments: true, refunds: { select: { amount: true } } },
      });
      if (!invoice) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Invoice not found',
        });
      }
      if (invoice.status === 'CANCELLED') {
        throw new BadRequestException({
          code: 'INVOICE_CANCELLED',
          message: 'This invoice is cancelled',
        });
      }
      // M16-W2: outstanding balance is NET of settled refunds.
      const paid =
        invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0) -
        invoice.refunds.reduce((sum, r) => sum + Number(r.amount), 0);
      const balance = Number(invoice.amount) - paid;
      if (balance <= 0) {
        throw new BadRequestException({
          code: 'NOTHING_TO_PAY',
          message: 'This invoice has no outstanding balance',
        });
      }
      // Soft guard: one live attempt per invoice keeps the UX and the
      // gateway ledger tidy. (The hard guard is the settlement lock.)
      const live = await tx.paymentAttempt.findFirst({
        where: {
          invoiceId,
          status: { in: ['CREATED', 'PENDING'] },
          createdAt: { gt: new Date(Date.now() - ATTEMPT_TTL_MS) },
        },
        select: { id: true },
      });
      if (live) {
        throw new ConflictException({
          code: 'ATTEMPT_IN_PROGRESS',
          message: 'A payment for this invoice is already in progress',
        });
      }
      const attempt = await tx.paymentAttempt.create({
        data: {
          collegeId: user.collegeId,
          invoiceId,
          initiatedById: user.id,
          amount: new Prisma.Decimal(balance.toFixed(2)),
          currency: 'PKR',
          provider,
          status: 'CREATED',
        },
      });
      return attempt;
    });
  }

  /** W2 hook: stamp the gateway reference once a checkout session exists. */
  async markPending(attemptId: string, providerRef: string) {
    const updated = await this.prisma.paymentAttempt.updateMany({
      where: { id: attemptId, status: 'CREATED' },
      data: { providerRef, status: 'PENDING' },
    });
    if (updated.count === 0) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: 'Attempt is not awaiting a gateway session',
      });
    }
  }

  /**
   * Webhook idempotency claim (consumed by W3). Insert-first on the
   * provider event id: returns true exactly once per event; a redelivery
   * hits the unique constraint and returns false.
   */
  async claimEvent(
    provider: string,
    eventId: string,
    attemptId: string | null,
    outcome: string,
  ): Promise<boolean> {
    try {
      await this.prisma.gatewayEvent.create({
        data: { provider, eventId, attemptId, outcome },
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Settle a verified gateway confirmation. Callers (W3 webhook / W2
   * verify-on-return) MUST have already authenticated the confirmation
   * (signature / server-to-server verify) — this method trusts its inputs
   * to be gateway-verified, and still re-validates amount/currency against
   * the frozen attempt and serializes on the invoice row.
   *
   * Returns the attempt after transition. Replays and double-confirms are
   * no-ops (CAS on PENDING). An over-balance confirmation is still recorded
   * — the money moved — with the invoice capped at PAID and the attempt
   * flagged `overpaid` for manual reconciliation (never drop settled money).
   */
  async settleAttempt(attemptId: string, confirmation: SettlementInput) {
    // Validation happens OUTSIDE the settlement transaction: a mismatch
    // must persist its FAILED marker, which a thrown exception inside the
    // transaction would roll back.
    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Payment attempt not found',
      });
    }
    // Verified-amount authority check: the gateway must confirm exactly
    // the frozen server-side amount, in PKR.
    if (
      confirmation.currency !== attempt.currency ||
      Number(confirmation.amount).toFixed(2) !==
        Number(attempt.amount).toFixed(2)
    ) {
      await this.prisma.paymentAttempt.updateMany({
        where: { id: attemptId, status: { in: ['CREATED', 'PENDING'] } },
        data: { status: 'FAILED', failureCode: 'AMOUNT_MISMATCH' },
      });
      throw new BadRequestException({
        code: 'AMOUNT_MISMATCH',
        message: 'Confirmed amount does not match the payment attempt',
      });
    }
    if (
      attempt.provider !== confirmation.provider ||
      (attempt.providerRef !== null &&
        attempt.providerRef !== confirmation.providerRef)
    ) {
      throw new BadRequestException({
        code: 'REFERENCE_MISMATCH',
        message: 'Confirmation does not match the payment attempt',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      // Serialize on the invoice row before touching balances.
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${attempt.invoiceId} FOR UPDATE`;

      // CAS: only one confirmation ever wins this transition.
      const claimed = await tx.paymentAttempt.updateMany({
        where: { id: attemptId, status: { in: ['CREATED', 'PENDING'] } },
        data: {
          status: 'SUCCEEDED',
          providerRef: confirmation.providerRef,
          confirmedAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        // Already settled/failed — idempotent no-op for replays. The
        // `justSettled` flag lets callers (webhook/verify) notify exactly
        // once without a second state machine.
        const current = await tx.paymentAttempt.findUniqueOrThrow({
          where: { id: attemptId },
        });
        return { ...current, justSettled: false };
      }

      const invoice = await tx.invoice.findUniqueOrThrow({
        where: { id: attempt.invoiceId },
        include: { payments: true, refunds: { select: { amount: true } } },
      });
      // M16-W2: balances are NET of settled refunds.
      const paid =
        invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0) -
        invoice.refunds.reduce((sum, r) => sum + Number(r.amount), 0);
      const balance = Number(invoice.amount) - paid;
      const overpaid = Number(attempt.amount) > balance;

      const payment = await tx.payment.create({
        data: {
          invoiceId: attempt.invoiceId,
          amount: attempt.amount,
          method: 'ONLINE',
          reference: confirmation.providerRef,
          paidAt: new Date(),
          recordedById: null, // gateway settlement — no staff recorder
        },
      });
      const newPaid = paid + Number(attempt.amount);
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: newPaid >= Number(invoice.amount) ? 'PAID' : 'PARTIAL',
        },
      });
      const settled = await tx.paymentAttempt.update({
        where: { id: attemptId },
        data: { paymentId: payment.id, overpaid },
      });
      const result = { ...settled, justSettled: true };

      await this.audit.log({
        collegeId: attempt.collegeId,
        actorId: null,
        action: 'payments.settled',
        targetType: 'Invoice',
        targetId: attempt.invoiceId,
        metadata: {
          attemptId,
          amount: attempt.amount.toString(),
          provider: attempt.provider,
          overpaid,
        },
      });
      return result;
    });
  }

  /**
   * Record a verified failure. CAS — replays are no-ops; `justFailed`
   * distinguishes the transition for exactly-once notifications.
   */
  async failAttempt(attemptId: string, failureCode: string) {
    const updated = await this.prisma.paymentAttempt.updateMany({
      where: { id: attemptId, status: { in: ['CREATED', 'PENDING'] } },
      data: { status: 'FAILED', failureCode },
    });
    const attempt = await this.prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    return { ...attempt, justFailed: updated.count > 0 };
  }

  /**
   * Lazy TTL sweep (same pattern as invoice OVERDUE transitions): attempts
   * stuck in CREATED/PENDING past the TTL become EXPIRED. A late verified
   * confirmation for an expired attempt is handled by settleAttempt's CAS —
   * EXPIRED is not settleable; reconciliation (W5) resolves such cases.
   */
  async expireStaleAttempts(collegeId: string): Promise<number> {
    const swept = await this.prisma.paymentAttempt.updateMany({
      where: {
        collegeId,
        status: { in: ['CREATED', 'PENDING'] },
        createdAt: { lt: new Date(Date.now() - ATTEMPT_TTL_MS) },
      },
      data: { status: 'EXPIRED' },
    });
    return swept.count;
  }
}
