import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateFeeStructureInput,
  FeeStructureItem,
  FeeSummary,
  GenerateInvoicesInput,
  GenerateInvoicesResult,
  InvoiceDetail,
  InvoiceItem,
  PageMeta,
  PaginationQuery,
  RecordPaymentInput,
  UpdateFeeStructureInput,
} from '@campusos/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../access/policy.service';
import { AuditService } from '../audit/audit.service';
import { changedFields } from '../audit/changed-fields';
import { EventsService } from '../events/events.module';
import type { AuthenticatedUser } from '../access/authenticated-user';
import { TermLifecycleService } from '../academics/term-lifecycle.service';
import { netPaid } from './money';
import { FinanceDocumentsService } from './finance-documents.service';
import { pageArgs, pageMeta } from '../common/pagination/pagination';

function forbidden(): ForbiddenException {
  return new ForbiddenException({
    code: 'FORBIDDEN',
    message: 'You do not have permission to perform this action',
  });
}

const invoiceInclude = {
  student: {
    include: { user: { select: { firstName: true, lastName: true } } },
  },
  structure: { select: { name: true } },
  payments: true,
  // M16-W2: invoice money is NET of settled refunds everywhere.
  refunds: { select: { amount: true } },
} satisfies Prisma.InvoiceInclude;

type InvoiceRecord = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

/**
 * M16-W2 (D-5): "paid" is NET of settled refunds —
 * netPaid = Σ Payment.amount − Σ Refund.amount. Payment/Refund rows and
 * Invoice.amount are immutable; only derived status/balances use this.
 */
function paidAmount(row: InvoiceRecord): number {
  return netPaid(row);
}

function toInvoiceItem(row: InvoiceRecord): InvoiceItem {
  const paid = paidAmount(row);
  return {
    id: row.id,
    invoiceNo: row.invoiceNo,
    studentId: row.studentId,
    studentName: `${row.student.user.firstName} ${row.student.user.lastName}`,
    rollNo: row.student.rollNo,
    structureName: row.structure.name,
    amount: row.amount.toString(),
    paidAmount: String(paid),
    balance: String(Number(row.amount) - paid),
    dueDate: row.dueDate.toISOString().slice(0, 10),
    status: row.status,
  };
}

@Injectable()
export class FeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: TermLifecycleService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly documents: FinanceDocumentsService,
  ) {}

  // ── Structures ─────────────────────────────────────────────

  private toStructureItem(row: Prisma.FeeStructureGetPayload<{
    include: {
      term: { select: { label: true } };
      course: { select: { code: true } };
      components: true;
      _count: { select: { invoices: true } };
    };
  }>): FeeStructureItem {
    return {
      id: row.id,
      termId: row.termId,
      termLabel: row.term.label,
      courseId: row.courseId,
      courseCode: row.course?.code ?? null,
      name: row.name,
      totalAmount: row.totalAmount.toString(),
      components: row.components.map((component) => ({
        id: component.id,
        label: component.label,
        amount: component.amount.toString(),
      })),
      invoiceCount: row._count.invoices,
    };
  }

  async listStructures(
    user: AuthenticatedUser,
    query: PaginationQuery,
  ): Promise<{ data: FeeStructureItem[]; meta: PageMeta }> {
    const where: Prisma.FeeStructureWhereInput = {
      collegeId: user.collegeId,
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.feeStructure.findMany({
        where,
        include: {
          term: { select: { label: true } },
          course: { select: { code: true } },
          components: true,
          _count: { select: { invoices: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...pageArgs(query),
      }),
      this.prisma.feeStructure.count({ where }),
    ]);
    return { data: rows.map((r) => this.toStructureItem(r)), meta: pageMeta(query, total) };
  }

  async createStructure(
    user: AuthenticatedUser,
    input: CreateFeeStructureInput,
  ): Promise<FeeStructureItem> {
    const term = await this.prisma.term.findFirst({
      where: { id: input.termId, collegeId: user.collegeId },
      select: { id: true },
    });
    if (!term) {
      throw new BadRequestException({
        code: 'INVALID_TERM',
        message: 'The selected term does not exist in this college',
      });
    }
    if (input.courseId) {
      const course = await this.prisma.course.findFirst({
        where: { id: input.courseId, collegeId: user.collegeId },
        select: { id: true },
      });
      if (!course) {
        throw new BadRequestException({
          code: 'INVALID_COURSE',
          message: 'The selected course does not exist in this college',
        });
      }
    }
    // Server computes the total — it always equals the component sum.
    const totalAmount = input.components.reduce((sum, c) => sum + c.amount, 0);

    // M17-W2 (D-1): term-bound fee structures cannot be created for a
    // CLOSED term. Guard + write share one transaction (Term FOR SHARE
    // vs close's FOR UPDATE — Term-before-Invoice lock order).
    const created = await this.prisma.$transaction(async (tx) => {
      await this.lifecycle.assertTermOpen(tx, user.collegeId, input.termId);
      return tx.feeStructure.create({
      data: {
        collegeId: user.collegeId,
        termId: input.termId,
        courseId: input.courseId ?? null,
        name: input.name,
        totalAmount,
        components: { create: input.components },
      },
      include: {
        term: { select: { label: true } },
        course: { select: { code: true } },
        components: true,
        _count: { select: { invoices: true } },
      },
      });
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'fees.structure_created',
      targetType: 'FeeStructure',
      targetId: created.id,
    });
    return this.toStructureItem(created);
  }

  async updateStructure(
    user: AuthenticatedUser,
    id: string,
    input: UpdateFeeStructureInput,
  ): Promise<FeeStructureItem> {
    // Tenancy: the structure is only ever located inside the caller's
    // own college. A cross-college id is a 404 before anything happens,
    // so a denied attempt can never reach the mutation or the audit.
    const existing = await this.prisma.feeStructure.findFirst({
      where: { id, collegeId: user.collegeId },
      include: { _count: { select: { components: true, invoices: true } } },
    });
    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Fee structure not found' });
    }
    const totalAmount = input.components
      ? input.components.reduce((sum, c) => sum + c.amount, 0)
      : undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      // M17-W2 (D-1/O-2 family): CLOSED-term structures are read-only.
      await this.lifecycle.assertTermOpen(tx, user.collegeId, existing.termId);
      if (input.components) {
        await tx.feeComponent.deleteMany({ where: { structureId: id } });
        await tx.feeComponent.createMany({
          data: input.components.map((c) => ({ structureId: id, ...c })),
        });
      }
      const row = await tx.feeStructure.update({
        where: { id },
        data: { name: input.name, totalAmount },
        include: {
          term: { select: { label: true } },
          course: { select: { code: true } },
          components: true,
          _count: { select: { invoices: true } },
        },
      });
      // M23-W2 (S-2): the most consequential unaudited mutation — a
      // component replacement silently rewrites what every future
      // invoice will charge. Audited INSIDE the transaction, so the
      // record exists iff the rewrite committed (a CLOSED-term rejection
      // or any later failure rolls both away together).
      //
      // Metadata is deliberately a shape summary, not the payload: which
      // fields changed, how many components were replaced, and the
      // before/after totals that describe the financial effect. No
      // component names, no client payload, no personal data, no ids
      // beyond the term this structure belongs to.
      await this.audit.logAtomic(
        {
          collegeId: user.collegeId, // server-derived tenant
          actorId: user.id, // server-derived principal
          action: 'fees.structure_updated',
          targetType: 'FeeStructure',
          targetId: row.id,
          metadata: {
            termId: existing.termId,
            changed: changedFields(['name'], existing, { name: input.name }),
            componentsReplaced: input.components !== undefined,
            componentCountBefore: existing._count.components,
            componentCountAfter: row.components.length,
            totalAmountBefore: existing.totalAmount.toString(),
            totalAmountAfter: row.totalAmount.toString(),
            // Blast radius: invoices already issued against this
            // structure keep their snapshot amount (M14 semantics).
            existingInvoiceCount: existing._count.invoices,
          },
        },
        tx,
      );
      return row;
    });
    return this.toStructureItem(updated);
  }

  // ── Invoice generation ─────────────────────────────────────

  /**
   * Generates invoices for the structure's audience (Blueprint W6):
   * course-scoped → students actively enrolled in any section of that course
   * in the structure's term; college-wide → all ENROLLED students. Students
   * who already hold an invoice for this structure are skipped. Amount is a
   * snapshot of the structure total. Emits invoice.issued per new invoice.
   */
  async generateInvoices(
    user: AuthenticatedUser,
    input: GenerateInvoicesInput,
  ): Promise<GenerateInvoicesResult> {
    const structure = await this.prisma.feeStructure.findFirst({
      where: { id: input.structureId, collegeId: user.collegeId },
    });
    if (!structure) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Fee structure not found' });
    }
    // M17-W2 (D-1): no NEW invoices against a CLOSED term (preflight;
    // re-asserted inside the creation transaction below).
    await this.lifecycle.assertTermOpen(this.prisma, user.collegeId, structure.termId);

    const students = await this.prisma.studentProfile.findMany({
      where: {
        collegeId: user.collegeId,
        status: 'ENROLLED',
        ...(structure.courseId
          ? {
              enrollments: {
                some: {
                  status: 'ACTIVE',
                  section: {
                    courseId: structure.courseId,
                    termId: structure.termId,
                  },
                },
              },
            }
          : {}),
      },
      select: { id: true, userId: true },
    });

    const existing = await this.prisma.invoice.findMany({
      where: { structureId: structure.id },
      select: { studentId: true },
    });
    const alreadyInvoiced = new Set(existing.map((invoice) => invoice.studentId));
    const targets = students.filter((student) => !alreadyInvoiced.has(student.id));

    const year = new Date().getFullYear();
    let sequence = await this.prisma.invoice.count({
      where: { collegeId: user.collegeId },
    });

    const dueDate = new Date(`${input.dueDate}T00:00:00Z`);
    const createdInvoices: Array<{ id: string; userId: string }> = [];
    await this.prisma.$transaction(async (tx) => {
      // M17-W2: re-assert INSIDE the creating transaction — invoices can
      // never be minted after the term's CLOSED state committed.
      await this.lifecycle.assertTermOpen(tx, user.collegeId, structure.termId);
      for (const student of targets) {
        sequence += 1;
        const invoice = await tx.invoice.create({
          data: {
            collegeId: user.collegeId,
            studentId: student.id,
            structureId: structure.id,
            invoiceNo: `INV-${year}-${String(sequence).padStart(5, '0')}`,
            amount: structure.totalAmount,
            dueDate,
          },
        });
        createdInvoices.push({ id: invoice.id, userId: student.userId });
      }
    });

    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'fees.invoices_generated',
      targetType: 'FeeStructure',
      targetId: structure.id,
      metadata: { created: createdInvoices.length, skipped: alreadyInvoiced.size },
    });
    for (const invoice of createdInvoices) {
      this.events.emit({
        type: 'invoice.issued',
        studentUserId: invoice.userId,
        invoiceId: invoice.id,
        amount: structure.totalAmount.toString(),
        dueDate: input.dueDate,
      });
    }
    return { created: createdInvoices.length, skipped: alreadyInvoiced.size };
  }

  // ── Invoices ───────────────────────────────────────────────

  /** Lazily transitions past-due PENDING/PARTIAL invoices to OVERDUE. */
  private async applyOverdueTransitions(collegeId: string): Promise<void> {
    await this.prisma.invoice.updateMany({
      where: {
        collegeId,
        status: { in: ['PENDING', 'PARTIAL'] },
        dueDate: { lt: new Date() },
      },
      data: { status: 'OVERDUE' },
    });
  }

  async listInvoices(
    user: AuthenticatedUser,
    query: PaginationQuery & { studentId?: string; status?: string },
  ): Promise<{ data: InvoiceItem[]; meta: PageMeta }> {
    const scope = await this.policy.scopeFor(user, 'fees.read');
    if (!scope) throw forbidden();
    await this.applyOverdueTransitions(user.collegeId);

    // M13-W3: CHILD scope requires an explicit child and an ACTIVE link.
    if (scope === 'CHILD') {
      if (!query.studentId) {
        throw new BadRequestException({
          code: 'MISSING_TARGET',
          message: 'Provide studentId',
        });
      }
      const allowed = await this.policy.can(user, 'fees.read', {
        studentProfileId: query.studentId,
      });
      if (!allowed) throw forbidden();
    }

    const where: Prisma.InvoiceWhereInput = {
      collegeId: user.collegeId,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.studentId && (scope === 'ALL' || scope === 'CHILD')
        ? { studentId: query.studentId }
        : {}),
      ...(scope === 'OWN' ? { student: { userId: user.id } } : {}),
      ...(query.q
        ? {
            OR: [
              { invoiceNo: { contains: query.q, mode: 'insensitive' } },
              {
                student: {
                  user: {
                    OR: [
                      { firstName: { contains: query.q, mode: 'insensitive' } },
                      { lastName: { contains: query.q, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        include: invoiceInclude,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(query),
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return { data: rows.map(toInvoiceItem), meta: pageMeta(query, total) };
  }

  async invoiceDetail(user: AuthenticatedUser, id: string): Promise<InvoiceDetail> {
    const scope = await this.policy.scopeFor(user, 'fees.read');
    if (!scope) throw forbidden();
    await this.applyOverdueTransitions(user.collegeId);

    const row = await this.prisma.invoice.findFirst({
      where: {
        id,
        collegeId: user.collegeId,
        ...(scope === 'OWN' ? { student: { userId: user.id } } : {}),
      },
      include: {
        ...invoiceInclude,
        structure: { include: { components: true } },
        payments: {
          include: { recordedBy: { select: { firstName: true, lastName: true } } },
          orderBy: { paidAt: 'asc' },
        },
        // M14-W4: attempt history for the payment UI — safe fields only.
        attempts: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Invoice not found' });
    }
    // M13-W3: CHILD scope — the invoice must belong to a linked child;
    // anything else is indistinguishable from a nonexistent invoice.
    if (scope === 'CHILD') {
      const allowed = await this.policy.can(user, 'fees.read', {
        studentProfileId: row.studentId,
      });
      if (!allowed) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Invoice not found' });
      }
    }
    return {
      ...toInvoiceItem(row),
      structureName: row.structure.name,
      components: row.structure.components.map((component) => ({
        label: component.label,
        amount: component.amount.toString(),
      })),
      payments: row.payments.map((payment) => ({
        id: payment.id,
        amount: payment.amount.toString(),
        method: payment.method,
        reference: payment.reference,
        paidAt: payment.paidAt.toISOString().slice(0, 10),
        recordedByName: payment.recordedBy
          ? `${payment.recordedBy.firstName} ${payment.recordedBy.lastName}`
          : 'Online payment', // M14: gateway settlements have no staff recorder
      })),
      attempts: row.attempts.map((attempt) => ({
        id: attempt.id,
        status: attempt.status,
        amount: attempt.amount.toString(),
        currency: attempt.currency,
        provider: attempt.provider,
        createdAt: attempt.createdAt.toISOString(),
        confirmedAt: attempt.confirmedAt?.toISOString() ?? null,
        failureCode: attempt.failureCode,
      })),
    };
  }

  async cancelInvoice(user: AuthenticatedUser, id: string): Promise<InvoiceItem> {
    const row = await this.prisma.invoice.findFirst({
      where: { id, collegeId: user.collegeId },
      include: invoiceInclude,
    });
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Invoice not found' });
    }
    if (row.payments.length > 0) {
      throw new ConflictException({
        code: 'HAS_PAYMENTS',
        message: 'Invoices with recorded payments cannot be cancelled',
      });
    }
    if (row.status === 'CANCELLED') {
      throw new BadRequestException({
        code: 'ALREADY_CANCELLED',
        message: 'This invoice is already cancelled',
      });
    }
    // M17-W2 (O-2): the term is resolved from the AUTHORITATIVE invoice→
    // structure relationship — never a client-supplied identifier — and
    // the guard shares the cancellation transaction.
    const structureTerm = await this.prisma.feeStructure.findUniqueOrThrow({
      where: { id: row.structureId },
      select: { termId: true },
    });
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lifecycle.assertTermOpen(tx, user.collegeId, structureTerm.termId);
      return tx.invoice.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: invoiceInclude,
      });
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'fees.invoice_cancelled',
      targetType: 'Invoice',
      targetId: id,
    });
    return toInvoiceItem(updated);
  }

  // ── Payments ───────────────────────────────────────────────

  /**
   * Records a manual payment (Blueprint W6) and recomputes the invoice
   * status transactionally: paid ≥ amount → PAID, > 0 → PARTIAL.
   */
  async recordPayment(
    user: AuthenticatedUser,
    invoiceId: string,
    input: RecordPaymentInput,
  ): Promise<InvoiceDetail> {
    // M14-W1: the balance check and the write now share one transaction
    // with a row lock on the invoice — two concurrent recordings (or a
    // manual recording racing a gateway settlement) can no longer both
    // read the same stale balance and jointly overpay.
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
      const row = await tx.invoice.findFirst({
        where: { id: invoiceId, collegeId: user.collegeId },
        include: invoiceInclude,
      });
      if (!row) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Invoice not found' });
      }
      if (row.status === 'CANCELLED') {
        throw new BadRequestException({
          code: 'INVOICE_CANCELLED',
          message: 'Payments cannot be recorded on a cancelled invoice',
        });
      }
      const balance = Number(row.amount) - paidAmount(row);
      if (input.amount > balance) {
        throw new BadRequestException({
          code: 'OVERPAYMENT',
          message: `Payment exceeds the outstanding balance (${balance})`,
        });
      }

      const newPaid = paidAmount(row) + input.amount;
      const newStatus = newPaid >= Number(row.amount) ? 'PAID' : 'PARTIAL';
      const payment = await tx.payment.create({
        data: {
          invoiceId,
          amount: input.amount,
          method: input.method,
          reference: input.reference,
          paidAt: input.paidAt ? new Date(`${input.paidAt}T00:00:00Z`) : new Date(),
          recordedById: user.id,
        },
      });
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: newStatus },
      });
      // M20-W1: the immutable receipt is issued in the SAME transaction as
      // the money event (snapshot at issuance — O-1/O-4).
      await this.documents.issueReceiptInTx(tx, {
        paymentId: payment.id,
        actorId: user.id,
      });
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'fees.payment_recorded',
      targetType: 'Invoice',
      targetId: invoiceId,
      metadata: { amount: input.amount, method: input.method },
    });
    return this.invoiceDetail(user, invoiceId);
  }

  // ── Summary ────────────────────────────────────────────────

  async summary(user: AuthenticatedUser): Promise<FeeSummary> {
    await this.applyOverdueTransitions(user.collegeId);
    const invoices = await this.prisma.invoice.findMany({
      where: { collegeId: user.collegeId, status: { not: 'CANCELLED' } },
      include: {
        payments: { select: { amount: true } },
        refunds: { select: { amount: true } },
      },
    });
    let invoiced = 0;
    let collected = 0;
    let paidCount = 0;
    let overdueCount = 0;
    for (const invoice of invoices) {
      invoiced += Number(invoice.amount);
      // M16-W2/M17-W2: collected is NET of settled refunds (shared helper).
      collected += netPaid(invoice);
      if (invoice.status === 'PAID') paidCount += 1;
      if (invoice.status === 'OVERDUE') overdueCount += 1;
    }
    return {
      invoicedTotal: String(invoiced),
      collectedTotal: String(collected),
      outstandingTotal: String(invoiced - collected),
      invoiceCount: invoices.length,
      paidCount,
      overdueCount,
    };
  }
}
