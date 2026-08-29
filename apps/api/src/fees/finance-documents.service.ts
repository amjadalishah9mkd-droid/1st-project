import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { netPaid } from './money';
import type { AuthenticatedUser } from '../access/authenticated-user';

type Tx = Prisma.TransactionClient;

const MAX_NUMBERING_RETRIES = 20;

/**
 * M20-W1 — immutable finance documents (Option B, locked O-1…O-15).
 *
 * A PAYMENT_RECEIPT acknowledges exactly one settled Payment row; a
 * REFUND_DOCUMENT acknowledges exactly one immutable Refund row
 * (`paymentId`/`refundId` unique = database idempotency — replay or a
 * concurrent duplicate can never create a second document). Every display
 * and financial value is FROZEN at issuance inside the SAME transaction as
 * the money event (or under the invoice lock for historical issuance);
 * documents are never reconstructed from mutable live data.
 *
 * Numbering (O-6/O-7): RCP-/RFD-<year>-<seq5>, unique per college.
 * Allocation is `max(sequence)+1` under a per-(college, kind, year)
 * advisory xact lock — NOT count-based — taken strictly AFTER the invoice
 * row lock (consistent lock ordering with every existing finance
 * transaction). The `@@unique([collegeId, receiptNo])` index is the DB
 * backstop; the standalone issuance paths additionally retry on P2002 with
 * an incremented sequence so out-of-band rows can never wedge issuance.
 *
 * Lifecycle (O-9/O-10): ACTIVE → VOID only, CAS-protected, reason
 * required, audited in the same transaction, number permanently consumed.
 */
@Injectable()
export class FinanceDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Embedded issuance (called INSIDE existing money transactions) ───────

  /**
   * Issue the receipt for a Payment that was created in THIS transaction.
   * The caller already holds the invoice FOR UPDATE lock. Never throws for
   * duplicate documents (paymentId unique makes replays structurally
   * impossible because settled money paths only create the Payment once).
   */
  async issueReceiptInTx(
    tx: Tx,
    input: { paymentId: string; actorId: string | null },
  ): Promise<void> {
    await this.createDocumentInTx(tx, {
      kind: 'PAYMENT_RECEIPT',
      paymentId: input.paymentId,
      actorId: input.actorId,
    });
  }

  /** Issue the document for a Refund created in THIS transaction. */
  async issueRefundDocumentInTx(
    tx: Tx,
    input: { refundId: string; actorId: string | null },
  ): Promise<void> {
    await this.createDocumentInTx(tx, {
      kind: 'REFUND_DOCUMENT',
      refundId: input.refundId,
      actorId: input.actorId,
    });
  }

  // ── Historical (on-demand) issuance — fees.manage, own transaction ──────

  /** Issue a receipt for a pre-M20 settled Payment (idempotent by DB). */
  async issueReceiptForPayment(user: AuthenticatedUser, paymentId: string) {
    return this.issueStandalone(user, { kind: 'PAYMENT_RECEIPT', paymentId });
  }

  /** Issue a document for a pre-M20 Refund (idempotent by DB). */
  async issueDocumentForRefund(user: AuthenticatedUser, refundId: string) {
    return this.issueStandalone(user, { kind: 'REFUND_DOCUMENT', refundId });
  }

  private async issueStandalone(
    user: AuthenticatedUser,
    source:
      | { kind: 'PAYMENT_RECEIPT'; paymentId: string }
      | { kind: 'REFUND_DOCUMENT'; refundId: string },
  ) {
    // Tenant gate FIRST (collegeId is server-derived, never client input):
    // the money row must belong to the caller's college or it does not
    // exist — 404 with no existence leak, mirroring fees.service.
    const invoiceId =
      source.kind === 'PAYMENT_RECEIPT'
        ? (
            await this.prisma.payment.findFirst({
              where: {
                id: source.paymentId,
                invoice: { collegeId: user.collegeId },
              },
              select: { invoiceId: true },
            })
          )?.invoiceId
        : (
            await this.prisma.refund.findFirst({
              where: {
                id: source.refundId,
                invoice: { collegeId: user.collegeId },
              },
              select: { invoiceId: true },
            })
          )?.invoiceId;
    if (!invoiceId) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message:
          source.kind === 'PAYMENT_RECEIPT'
            ? 'Payment not found'
            : 'Refund not found',
      });
    }

    const existing = await this.prisma.financeDocument.findUnique({
      where:
        source.kind === 'PAYMENT_RECEIPT'
          ? { paymentId: source.paymentId }
          : { refundId: source.refundId },
      select: { id: true, receiptNo: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'ALREADY_ISSUED',
        message: `A document was already issued (${existing.receiptNo})`,
      });
    }

    // Backstop retry loop (each attempt is its own transaction; a P2002 on
    // the number index aborts only that attempt).
    for (let attempt = 0; attempt < MAX_NUMBERING_RETRIES; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // Same lock ordering as every finance transaction: invoice first.
          await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
          return this.createDocumentInTx(tx, {
            kind: source.kind,
            paymentId:
              source.kind === 'PAYMENT_RECEIPT' ? source.paymentId : undefined,
            refundId:
              source.kind === 'REFUND_DOCUMENT' ? source.refundId : undefined,
            actorId: user.id,
            sequenceBump: attempt, // skip past out-of-band collisions
          });
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const target = String(
            (error.meta?.target as string[] | string | undefined) ?? '',
          );
          if (target.includes('paymentId') || target.includes('refundId')) {
            // Concurrency loser: the document already exists.
            throw new ConflictException({
              code: 'ALREADY_ISSUED',
              message: 'A document was already issued for this transaction',
            });
          }
          continue; // number collision — retry with a bumped sequence
        }
        throw error;
      }
    }
    throw new ConflictException({
      code: 'NUMBERING_EXHAUSTED',
      message: 'Could not allocate a document number. Try again.',
    });
  }

  // ── Void (O-9/O-10) — CAS, reason required, audited in-tx ────────────────

  async voidDocument(
    user: AuthenticatedUser,
    documentId: string,
    reason: string,
  ) {
    const trimmed = reason.trim();
    if (trimmed.length < 5) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'Provide a void reason (at least 5 characters)',
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.financeDocument.findFirst({
        where: { id: documentId, collegeId: user.collegeId },
        select: { id: true, receiptNo: true, kind: true, status: true },
      });
      if (!doc) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Document not found',
        });
      }
      // CAS: exactly one void ever wins; VOID → VOID conflicts; VOID can
      // never return to ACTIVE (no update path exists at all).
      const claimed = await tx.financeDocument.updateMany({
        where: { id: doc.id, status: 'ACTIVE' },
        data: {
          status: 'VOID',
          voidedById: user.id,
          voidedAt: new Date(),
          voidReason: trimmed,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: 'This document is already void',
        });
      }
      await this.audit.log(
        {
          collegeId: user.collegeId,
          actorId: user.id,
          action: 'fees.receipt_voided',
          targetType: 'FinanceDocument',
          targetId: doc.id,
          metadata: { receiptNo: doc.receiptNo, kind: doc.kind },
        },
        tx,
      );
      return tx.financeDocument.findUniqueOrThrow({ where: { id: doc.id } });
    });
  }

  // ── Core snapshot + numbering ────────────────────────────────────────────

  private async createDocumentInTx(
    tx: Tx,
    input: {
      kind: 'PAYMENT_RECEIPT' | 'REFUND_DOCUMENT';
      paymentId?: string;
      refundId?: string;
      actorId: string | null;
      sequenceBump?: number;
    },
  ) {
    // Load the immutable money row + all display context ONCE, inside the
    // money transaction — this is the snapshot moment.
    const payment = await tx.payment.findUniqueOrThrow({
      where: {
        id:
          input.kind === 'PAYMENT_RECEIPT'
            ? input.paymentId!
            : (
                await tx.refund.findUniqueOrThrow({
                  where: { id: input.refundId! },
                  select: { paymentId: true },
                })
              ).paymentId,
      },
      include: {
        recordedBy: { select: { firstName: true, lastName: true } },
        receipt: { select: { receiptNo: true } },
        invoice: {
          include: {
            payments: { select: { amount: true } },
            refunds: { select: { amount: true } },
            college: { select: { name: true, code: true } },
            structure: { select: { name: true } },
            student: {
              include: {
                user: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    });
    const refund =
      input.kind === 'REFUND_DOCUMENT'
        ? await tx.refund.findUniqueOrThrow({
            where: { id: input.refundId! },
            include: {
              recordedBy: { select: { firstName: true, lastName: true } },
            },
          })
        : null;

    const invoice = payment.invoice;
    const money = refund ?? payment;
    const receivedBy = refund ? refund.recordedBy : payment.recordedBy;
    const balanceAfter = Number(invoice.amount) - netPaid(invoice);

    const prefix = input.kind === 'PAYMENT_RECEIPT' ? 'RCP' : 'RFD';
    const year = new Date().getUTCFullYear();
    // Advisory xact lock serializes allocation per (college, kind, year);
    // released automatically at commit/rollback. Taken AFTER the invoice
    // lock in every path — consistent ordering, no deadlock cycles.
    // (SELECT ... FROM: pg_advisory_xact_lock returns void, which the
    // driver cannot deserialize as a column.)
    await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`${invoice.collegeId}:${prefix}:${year}`}))`;
    const agg = await tx.financeDocument.aggregate({
      where: { collegeId: invoice.collegeId, kind: input.kind, year },
      _max: { sequence: true },
    });
    const sequence =
      (agg._max.sequence ?? 0) + 1 + (input.sequenceBump ?? 0);
    const receiptNo = `${prefix}-${year}-${String(sequence).padStart(5, '0')}`;

    const document = await tx.financeDocument.create({
      data: {
        collegeId: invoice.collegeId, // server-derived — never client input
        kind: input.kind,
        receiptNo,
        year,
        sequence,
        paymentId: input.kind === 'PAYMENT_RECEIPT' ? payment.id : null,
        refundId: refund?.id ?? null,
        invoiceId: invoice.id,
        // Frozen snapshot (O-4): display context + figures at issuance.
        studentName:
          `${invoice.student.user.firstName} ${invoice.student.user.lastName}`.trim(),
        admissionNo: invoice.student.admissionNo,
        rollNo: invoice.student.rollNo,
        invoiceNo: invoice.invoiceNo,
        structureName: invoice.structure.name,
        collegeName: invoice.college.name,
        collegeCode: invoice.college.code,
        amount: money.amount,
        method: money.method,
        referenceMasked: maskReference(money.reference),
        paidAt: refund ? refund.refundedAt : payment.paidAt,
        invoiceAmount: invoice.amount,
        balanceAfter,
        receivedByName: receivedBy
          ? `${receivedBy.firstName} ${receivedBy.lastName}`.trim()
          : null,
        parentReceiptNo: refund ? (payment.receipt?.receiptNo ?? null) : null,
        issuedById: input.actorId,
      },
    });

    await this.audit.log(
      {
        collegeId: invoice.collegeId,
        actorId: input.actorId,
        action: 'fees.receipt_issued',
        targetType: 'FinanceDocument',
        targetId: document.id,
        metadata: {
          receiptNo,
          kind: input.kind,
          ...(input.kind === 'PAYMENT_RECEIPT'
            ? { paymentId: payment.id }
            : { refundId: refund!.id }),
        },
      },
      tx,
    );
    return document;
  }
}

/** Provider tokens/references are capability-adjacent — keep last 6 only. */
function maskReference(reference: string | null): string | null {
  if (!reference) return null;
  return reference.length <= 6 ? reference : `…${reference.slice(-6)}`;
}
