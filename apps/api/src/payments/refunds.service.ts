import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateRefundInput,
  PaymentRefundSummary,
  RefundAttemptItem,
  RefundItem,
  RefundsQueryInput,
} from '@campusos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { netPaid } from '../fees/money';
import { PolicyService } from '../access/policy.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.module';
import type { AuthenticatedUser } from '../access/authenticated-user';
import {
  PAYMENT_GATEWAY,
  type PaymentGatewayAdapter,
  type RefundResult,
} from './gateway.adapter';

/**
 * M16-W2 — refund engine (docs/M16_REFUNDS_DESIGN.md, decisions D-1…D-8).
 *
 * Invariants:
 *  - A `Refund` row means money HAS been returned; it is immutable and is
 *    only ever materialized by a SUCCEEDED transition (RECORDED staff
 *    confirmation, or provider-verified truth — never client claims).
 *  - `RefundAttempt` is the lifecycle: REQUESTED → PROCESSING → SUCCEEDED/
 *    FAILED, REQUESTED → SUCCEEDED (RECORDED), REQUESTED → CANCELLED.
 *    Terminal states are never resurrected; retry-after-FAILED = new
 *    attempt. Every transition is CAS-guarded (`updateMany where status`).
 *  - Money safety: `refundable = payment.amount − Σ Refund.amount` is
 *    recomputed INSIDE a transaction holding `SELECT … FOR UPDATE` on the
 *    Invoice row (the same lock settlement/manual recording use, so
 *    refunds serialize against incoming money) — at creation AND again at
 *    execution. The DB partial unique index
 *    `RefundAttempt_one_inflight_per_payment` is the concurrency backstop.
 *  - Tenancy: payments are resolved through the authenticated collegeId;
 *    the invoice identity is DERIVED from the payment; the client never
 *    supplies collegeId/invoiceId/provider refs/amount-after-creation.
 *  - D-5: invoice status is derived from netPaid = Σ payments − Σ refunds
 *    (net 0 → PENDING). Invoice.amount / invoiceNo / Payment rows are
 *    never mutated; CANCELLED invoices keep their status (D-7 still
 *    allows refunding their settled payments).
 *  - D-8: PaymentAttemptStatus.REFUNDED stays unused.
 *  - Provider ambiguity rule: a failed/unreachable provider call NEVER
 *    directly fails the attempt — the attempt stays PROCESSING and truth
 *    is re-established from the reporter (verify), because the money may
 *    have moved. Only reporter-confirmed absence (or amount mismatch)
 *    fails it.
 */

const notFound = () =>
  new NotFoundException({ code: 'NOT_FOUND', message: 'Payment not found' });

const attemptNotFound = () =>
  new NotFoundException({
    code: 'NOT_FOUND',
    message: 'Refund attempt not found',
  });

type Tx = Prisma.TransactionClient;

@Injectable()
export class RefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayAdapter,
  ) {}

  // ── shared helpers ───────────────────────────────────────────

  /** Tenant-scoped payment resolution (invoice derived, never supplied). */
  private async resolvePayment(tx: Tx, user: AuthenticatedUser, paymentId: string) {
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, invoice: { collegeId: user.collegeId } },
      include: {
        invoice: { select: { id: true, collegeId: true, invoiceNo: true, status: true } },
        attempt: { select: { providerRef: true, provider: true } },
      },
    });
    if (!payment) throw notFound();
    return payment;
  }

  /** Σ settled refunds for a payment — INSIDE the caller's transaction. */
  private async refundedSum(tx: Tx, paymentId: string): Promise<number> {
    const agg = await tx.refund.aggregate({
      where: { paymentId },
      _sum: { amount: true },
    });
    return Number(agg._sum.amount ?? 0);
  }

  /**
   * D-5 — derived invoice status from net paid. Never touches amount or
   * invoiceNo; CANCELLED is preserved (existing cancellation semantics);
   * a past-due PENDING/PARTIAL result is re-marked OVERDUE by the
   * existing lazy sweep, exactly as after manual payment recording.
   */
  private async recomputeInvoiceStatus(tx: Tx, invoiceId: string): Promise<void> {
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: {
        payments: { select: { amount: true } },
        refunds: { select: { amount: true } },
      },
    });
    if (invoice.status === 'CANCELLED') return;
    const net = netPaid(invoice);
    const status =
      net >= Number(invoice.amount) && net > 0
        ? 'PAID'
        : net > 0
          ? 'PARTIAL'
          : 'PENDING';
    if (status !== invoice.status) {
      await tx.invoice.update({ where: { id: invoiceId }, data: { status } });
    }
  }

  private toAttemptItem(row: {
    id: string;
    paymentId: string;
    invoiceId: string;
    amount: Prisma.Decimal;
    currency: string;
    reason: string;
    method: 'PROVIDER' | 'RECORDED';
    provider: string | null;
    providerRefundRef: string | null;
    status: 'REQUESTED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
    failureCode: string | null;
    requestedById: string;
    confirmedAt: Date | null;
    createdAt: Date;
    invoice?: { invoiceNo: string };
  }): RefundAttemptItem {
    return {
      id: row.id,
      paymentId: row.paymentId,
      invoiceId: row.invoiceId,
      invoiceNo: row.invoice?.invoiceNo ?? '',
      amount: row.amount.toString(),
      currency: row.currency,
      reason: row.reason,
      method: row.method,
      provider: row.provider,
      providerRefundRef: row.providerRefundRef,
      status: row.status,
      failureCode: row.failureCode,
      requestedById: row.requestedById,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Emit the terminal-outcome event exactly once (caller passes the CAS flag). */
  private async notifyOutcome(
    attemptId: string,
    outcome: 'succeeded' | 'failed',
  ): Promise<void> {
    const attempt = await this.prisma.refundAttempt.findUnique({
      where: { id: attemptId },
      include: {
        invoice: {
          select: { id: true, invoiceNo: true, student: { select: { userId: true } } },
        },
      },
    });
    if (!attempt) return;
    if (outcome === 'succeeded') {
      this.events.emit({
        type: 'refund.succeeded',
        studentUserId: attempt.invoice.student.userId,
        invoiceId: attempt.invoiceId,
        attemptId: attempt.id,
        amount: attempt.amount.toString(),
        invoiceNo: attempt.invoice.invoiceNo,
      });
    } else {
      this.events.emit({
        type: 'refund.failed',
        requesterUserId: attempt.requestedById,
        invoiceId: attempt.invoiceId,
        attemptId: attempt.id,
        amount: attempt.amount.toString(),
        invoiceNo: attempt.invoice.invoiceNo,
        failureCode: attempt.failureCode ?? 'UNKNOWN',
      });
    }
  }

  // ── create (REQUESTED) ───────────────────────────────────────

  async create(
    user: AuthenticatedUser,
    paymentId: string,
    input: CreateRefundInput,
  ): Promise<RefundAttemptItem> {
    const created = await this.prisma.$transaction(async (tx) => {
      const payment = await this.resolvePayment(tx, user, paymentId);
      // Serialize against settlements, manual recordings and other refunds.
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${payment.invoiceId} FOR UPDATE`;

      if (input.method === 'PROVIDER') {
        if (payment.method !== 'ONLINE' || !payment.attempt?.providerRef) {
          throw new BadRequestException({
            code: 'PROVIDER_UNAVAILABLE',
            message:
              'This payment was not settled by a gateway — record the refund instead',
          });
        }
        if (input.currency !== 'PKR') {
          throw new BadRequestException({
            code: 'CURRENCY_MISMATCH',
            message: 'Refund currency must match the payment currency',
          });
        }
      }

      const refunded = await this.refundedSum(tx, payment.id);
      const refundable = Number(payment.amount) - refunded;
      if (input.amount > refundable) {
        throw new BadRequestException({
          code: 'EXCEEDS_REFUNDABLE',
          message: `Refund exceeds the refundable amount (${refundable.toFixed(2)})`,
        });
      }

      try {
        return await tx.refundAttempt.create({
          data: {
            collegeId: user.collegeId,
            paymentId: payment.id,
            invoiceId: payment.invoiceId,
            amount: new Prisma.Decimal(input.amount.toFixed(2)),
            currency: input.currency,
            reason: input.reason,
            method: input.method,
            provider:
              input.method === 'PROVIDER' ? (payment.attempt?.provider ?? null) : null,
            requestedById: user.id,
          },
          include: { invoice: { select: { invoiceNo: true } } },
        });
      } catch (error) {
        // DB backstop: RefundAttempt_one_inflight_per_payment.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException({
            code: 'REFUND_IN_PROGRESS',
            message: 'A refund for this payment is already in progress',
          });
        }
        throw error;
      }
    });

    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'payments.refund_requested',
      targetType: 'Payment',
      targetId: paymentId,
      metadata: {
        attemptId: created.id,
        amount: created.amount.toString(),
        method: created.method,
      },
    });
    return this.toAttemptItem(created);
  }

  // ── cancel (REQUESTED → CANCELLED) ───────────────────────────

  async cancel(user: AuthenticatedUser, attemptId: string): Promise<RefundAttemptItem> {
    const attempt = await this.prisma.refundAttempt.findFirst({
      where: { id: attemptId, collegeId: user.collegeId },
    });
    if (!attempt) throw attemptNotFound();
    const cancelled = await this.prisma.refundAttempt.updateMany({
      where: { id: attemptId, status: 'REQUESTED' },
      data: { status: 'CANCELLED' },
    });
    if (cancelled.count === 0) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: 'Only requested refunds can be cancelled',
      });
    }
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'payments.refund_cancelled',
      targetType: 'Payment',
      targetId: attempt.paymentId,
      metadata: { attemptId, amount: attempt.amount.toString() },
    });
    const current = await this.prisma.refundAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { invoice: { select: { invoiceNo: true } } },
    });
    return this.toAttemptItem(current);
  }

  // ── execute (typed confirmation; REQUESTED → …) ──────────────

  async execute(
    user: AuthenticatedUser,
    attemptId: string,
    confirmAmount: string,
  ): Promise<RefundAttemptItem> {
    const attempt = await this.prisma.refundAttempt.findFirst({
      where: { id: attemptId, collegeId: user.collegeId },
      include: { invoice: { select: { invoiceNo: true } } },
    });
    if (!attempt) throw attemptNotFound();

    // M15-rollover-style typed confirmation, validated SERVER-side against
    // the frozen attempt amount — the UI's disabled button is not a control.
    const frozen = Number(attempt.amount).toFixed(2);
    if (
      confirmAmount.trim() !== frozen &&
      Number(confirmAmount) !== Number(frozen)
    ) {
      throw new BadRequestException({
        code: 'CONFIRMATION_MISMATCH',
        message: 'Type the exact refund amount to confirm',
      });
    }
    if (attempt.status !== 'REQUESTED') {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: 'This refund is not awaiting execution',
      });
    }

    if (attempt.method === 'RECORDED') {
      return this.executeRecorded(user, attemptId);
    }
    return this.executeProvider(user, attemptId);
  }

  /** RECORDED: staff confirmation IS the authoritative act — one tx. */
  private async executeRecorded(
    user: AuthenticatedUser,
    attemptId: string,
  ): Promise<RefundAttemptItem> {
    const { item, justSucceeded } = await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.refundAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${attempt.invoiceId} FOR UPDATE`;

      // Re-check headroom inside the lock (never trust creation time).
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: attempt.paymentId },
      });
      const refunded = await this.refundedSum(tx, attempt.paymentId);
      if (Number(attempt.amount) > Number(payment.amount) - refunded) {
        throw new BadRequestException({
          code: 'EXCEEDS_REFUNDABLE',
          message: 'Refund exceeds the refundable amount',
        });
      }

      // CAS: exactly one execution wins.
      const claimed = await tx.refundAttempt.updateMany({
        where: { id: attemptId, status: 'REQUESTED' },
        data: { status: 'SUCCEEDED', confirmedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: 'This refund is not awaiting execution',
        });
      }

      const refund = await tx.refund.create({
        data: {
          paymentId: attempt.paymentId,
          invoiceId: attempt.invoiceId,
          amount: attempt.amount,
          method: 'RECORDED',
          reference: null,
          refundedAt: new Date(),
          recordedById: user.id,
        },
      });
      const updated = await tx.refundAttempt.update({
        where: { id: attemptId },
        data: { refundId: refund.id },
        include: { invoice: { select: { invoiceNo: true } } },
      });
      await this.recomputeInvoiceStatus(tx, attempt.invoiceId);

      await this.audit.log({
        collegeId: attempt.collegeId,
        actorId: user.id,
        action: 'payments.refund_succeeded',
        targetType: 'Payment',
        targetId: attempt.paymentId,
        metadata: {
          attemptId,
          refundId: refund.id,
          amount: attempt.amount.toString(),
          method: 'RECORDED',
        },
      });
      return { item: this.toAttemptItem(updated), justSucceeded: true };
    });

    if (justSucceeded) await this.notifyOutcome(attemptId, 'succeeded');
    return item;
  }

  /**
   * PROVIDER: REQUESTED → PROCESSING (re-checked, CAS) → adapter call →
   * reporter-verified finalization. An unreachable/rejected call leaves
   * the attempt PROCESSING; `verify` establishes truth (money-safety rule).
   */
  private async executeProvider(
    user: AuthenticatedUser,
    attemptId: string,
  ): Promise<RefundAttemptItem> {
    // Phase 1: claim PROCESSING with the headroom re-check inside the lock.
    const context = await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.refundAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${attempt.invoiceId} FOR UPDATE`;
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: attempt.paymentId },
        include: { attempt: { select: { providerRef: true } } },
      });
      const refunded = await this.refundedSum(tx, attempt.paymentId);
      if (Number(attempt.amount) > Number(payment.amount) - refunded) {
        throw new BadRequestException({
          code: 'EXCEEDS_REFUNDABLE',
          message: 'Refund exceeds the refundable amount',
        });
      }
      const claimed = await tx.refundAttempt.updateMany({
        where: { id: attemptId, status: 'REQUESTED' },
        data: { status: 'PROCESSING' },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: 'This refund is not awaiting execution',
        });
      }
      return { providerRef: payment.attempt!.providerRef! };
    });

    // Phase 2: provider call OUTSIDE any transaction. Failures here leave
    // PROCESSING — verification decides truth (the call may have applied).
    try {
      await this.gateway.createRefund({
        providerRef: context.providerRef,
        amount: Number(
          (await this.prisma.refundAttempt.findUniqueOrThrow({ where: { id: attemptId } }))
            .amount,
        ).toFixed(2),
        currency: 'PKR',
      });
    } catch {
      // Ambiguous by design — fall through to verification.
    }

    // Phase 3: reporter truth → SUCCEEDED / FAILED / stay PROCESSING.
    return this.reconcileProcessing(user, attemptId, context.providerRef);
  }

  /**
   * Reporter-truth reconciliation for a PROCESSING attempt. Replay-safe:
   * every terminal transition is CAS'd, Refund creation is unique via
   * refundId/@@unique(provider, providerRefundRef), and repeats no-op.
   */
  private async reconcileProcessing(
    user: AuthenticatedUser,
    attemptId: string,
    providerRef: string,
  ): Promise<RefundAttemptItem> {
    let truth: RefundResult | null = null;
    try {
      truth = await this.gateway.verifyRefund(providerRef);
    } catch {
      truth = null; // provider unreachable — stay PROCESSING
    }

    if (truth) {
      const attempt = await this.prisma.refundAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
      const frozen = Number(attempt.amount).toFixed(2);
      // Provider refund records not yet claimed by any CampusOS attempt.
      const claimedRefs = new Set(
        (
          await this.prisma.refundAttempt.findMany({
            where: { providerRefundRef: { not: null } },
            select: { providerRefundRef: true },
          })
        ).map((row) => row.providerRefundRef as string),
      );
      const unclaimed = truth.refunds.filter((r) => !claimedRefs.has(r.ref));
      const match = unclaimed.find(
        (r) => Number(r.amount).toFixed(2) === frozen,
      );

      if (match) {
        const { justSucceeded, item } = await this.finalizeProviderSuccess(
          user,
          attemptId,
          match.ref,
        );
        if (justSucceeded) await this.notifyOutcome(attemptId, 'succeeded');
        return item;
      }
      if (unclaimed.length > 0) {
        // The provider executed something that does NOT match the frozen
        // amount — settle-attempt precedent: hard failure, no Refund row.
        const failed = await this.failProcessing(user, attemptId, 'AMOUNT_MISMATCH');
        if (failed.justFailed) await this.notifyOutcome(attemptId, 'failed');
        return failed.item;
      }
      // Reporter reachable and shows NO new refund → the call did not
      // apply. Definite rejection: FAILED (retry = new attempt).
      const failed = await this.failProcessing(user, attemptId, 'PROVIDER_REJECTED');
      if (failed.justFailed) await this.notifyOutcome(attemptId, 'failed');
      return failed.item;
    }

    // Ambiguous (reporter unreachable): remain PROCESSING.
    const current = await this.prisma.refundAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { invoice: { select: { invoiceNo: true } } },
    });
    return this.toAttemptItem(current);
  }

  private async finalizeProviderSuccess(
    user: AuthenticatedUser,
    attemptId: string,
    providerRefundRef: string,
  ): Promise<{ justSucceeded: boolean; item: RefundAttemptItem }> {
    return this.prisma.$transaction(async (tx) => {
      const attempt = await tx.refundAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${attempt.invoiceId} FOR UPDATE`;
      const claimed = await tx.refundAttempt.updateMany({
        where: { id: attemptId, status: 'PROCESSING' },
        data: {
          status: 'SUCCEEDED',
          providerRefundRef,
          confirmedAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        // Replay / concurrent finalization — idempotent no-op.
        const current = await tx.refundAttempt.findUniqueOrThrow({
          where: { id: attemptId },
          include: { invoice: { select: { invoiceNo: true } } },
        });
        return { justSucceeded: false, item: this.toAttemptItem(current) };
      }
      const refund = await tx.refund.create({
        data: {
          paymentId: attempt.paymentId,
          invoiceId: attempt.invoiceId,
          amount: attempt.amount,
          method: 'PROVIDER',
          reference: providerRefundRef,
          refundedAt: new Date(),
          recordedById: null, // provider-confirmed — no staff recorder
        },
      });
      const updated = await tx.refundAttempt.update({
        where: { id: attemptId },
        data: { refundId: refund.id },
        include: { invoice: { select: { invoiceNo: true } } },
      });
      await this.recomputeInvoiceStatus(tx, attempt.invoiceId);
      await this.audit.log({
        collegeId: attempt.collegeId,
        actorId: user.id,
        action: 'payments.refund_succeeded',
        targetType: 'Payment',
        targetId: attempt.paymentId,
        metadata: {
          attemptId,
          refundId: refund.id,
          amount: attempt.amount.toString(),
          method: 'PROVIDER',
        },
      });
      return { justSucceeded: true, item: this.toAttemptItem(updated) };
    });
  }

  private async failProcessing(
    user: AuthenticatedUser,
    attemptId: string,
    failureCode: string,
  ): Promise<{ justFailed: boolean; item: RefundAttemptItem }> {
    const failed = await this.prisma.refundAttempt.updateMany({
      where: { id: attemptId, status: 'PROCESSING' },
      data: { status: 'FAILED', failureCode },
    });
    const current = await this.prisma.refundAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { invoice: { select: { invoiceNo: true } } },
    });
    if (failed.count > 0) {
      await this.audit.log({
        collegeId: current.collegeId,
        actorId: user.id,
        action: 'payments.refund_failed',
        targetType: 'Payment',
        targetId: current.paymentId,
        metadata: {
          attemptId,
          amount: current.amount.toString(),
          failureCode,
        },
      });
    }
    return { justFailed: failed.count > 0, item: this.toAttemptItem(current) };
  }

  // ── verify (PROCESSING reconciliation; replay-safe) ──────────

  async verify(user: AuthenticatedUser, attemptId: string): Promise<RefundAttemptItem> {
    const attempt = await this.prisma.refundAttempt.findFirst({
      where: { id: attemptId, collegeId: user.collegeId },
      include: {
        payment: { include: { attempt: { select: { providerRef: true } } } },
        invoice: { select: { invoiceNo: true } },
      },
    });
    if (!attempt) throw attemptNotFound();
    if (attempt.status !== 'PROCESSING' || !attempt.payment.attempt?.providerRef) {
      // Terminal / not-yet-executed attempts are returned as-is —
      // verification never resurrects or advances them.
      return this.toAttemptItem(attempt);
    }
    return this.reconcileProcessing(
      user,
      attemptId,
      attempt.payment.attempt.providerRef,
    );
  }

  // ── reads ────────────────────────────────────────────────────

  /** Per-payment history + server-computed headroom (staff ALL / student OWN). */
  async paymentSummary(
    user: AuthenticatedUser,
    paymentId: string,
  ): Promise<PaymentRefundSummary> {
    const scope = await this.policy.scopeFor(user, 'fees.read');
    if (!scope) throw notFound();
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        invoice: {
          collegeId: user.collegeId,
          ...(scope === 'OWN' ? { student: { userId: user.id } } : {}),
        },
      },
      include: {
        refunds: { orderBy: { refundedAt: 'asc' } },
        refundAttempts: {
          orderBy: { createdAt: 'desc' },
          include: { invoice: { select: { invoiceNo: true } } },
        },
      },
    });
    if (!payment) throw notFound();
    // M17-W3 (D-5): guardians read STRICTLY through the existing CHILD
    // authorization — the payment's invoice must belong to a linked child
    // (fees.service getInvoice precedent). Anything else is a plain 404.
    if (scope === 'CHILD') {
      const invoice = await this.prisma.invoice.findUniqueOrThrow({
        where: { id: payment.invoiceId },
        select: { studentId: true },
      });
      const allowed = await this.policy.can(user, 'fees.read', {
        studentProfileId: invoice.studentId,
      });
      if (!allowed) throw notFound();
    }
    const refunded = payment.refunds.reduce((s, r) => s + Number(r.amount), 0);
    return {
      paymentId: payment.id,
      paymentAmount: payment.amount.toString(),
      refunded: refunded.toFixed(2),
      refundable: (Number(payment.amount) - refunded).toFixed(2),
      refunds: payment.refunds.map(
        (r): RefundItem => ({
          id: r.id,
          paymentId: r.paymentId,
          invoiceId: r.invoiceId,
          amount: r.amount.toString(),
          method: r.method,
          reference: r.reference,
          refundedAt: r.refundedAt.toISOString(),
        }),
      ),
      attempts: payment.refundAttempts.map((a) => this.toAttemptItem(a)),
    };
  }

  /** Reconciliation-style listing (fees.manage resolved ALL). */
  async list(
    user: AuthenticatedUser,
    query: RefundsQueryInput,
  ): Promise<RefundAttemptItem[]> {
    const scope = await this.policy.scopeFor(user, 'fees.manage');
    if (scope !== 'ALL') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      });
    }
    const rows = await this.prisma.refundAttempt.findMany({
      where: {
        collegeId: user.collegeId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.method ? { method: query.method } : {}),
        ...(query.invoiceNo
          ? {
              invoice: {
                invoiceNo: { contains: query.invoiceNo, mode: 'insensitive' },
              },
            }
          : {}),
      },
      include: { invoice: { select: { invoiceNo: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => this.toAttemptItem(row));
  }
}
