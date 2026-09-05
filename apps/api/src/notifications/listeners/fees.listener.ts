import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type {
  InvoiceIssuedEvent,
  InvoiceOverdueEvent,
  PaymentFailedEvent,
  PaymentSucceededEvent,
  RefundFailedEvent,
  RefundSucceededEvent,
} from '@campusos/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { renderTemplate } from '../templates';
import { NotificationMailerService } from '../notification-mailer.service';

/** Fee notification listeners (Blueprint §10, M6). */
@Injectable()
export class FeesListener {
  private readonly logger = new Logger(FeesListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: NotificationMailerService,
  ) {}

  @OnEvent('invoice.issued')
  async onIssued(event: InvoiceIssuedEvent): Promise<void> {
    await this.create(event.studentUserId, event);
  }

  @OnEvent('invoice.overdue')
  async onOverdue(event: InvoiceOverdueEvent): Promise<void> {
    await this.create(event.studentUserId, event);
  }

  // M14-W3 — online payment outcomes. Emitted AFTER the settlement
  // transaction commits; a notification/mail failure can never touch
  // payment state (existing bus semantics).
  // M16-W2 — refund outcomes. Emitted exactly once per terminal
  // transition (CAS-flag guarded in RefundsService); the success goes to
  // the student, the failure to the finance staffer who requested it.
  @OnEvent('refund.succeeded')
  async onRefundSucceeded(event: RefundSucceededEvent): Promise<void> {
    await this.createRefund(event.studentUserId, event, 'refund_succeeded');
  }

  @OnEvent('refund.failed')
  async onRefundFailed(event: RefundFailedEvent): Promise<void> {
    await this.createRefund(event.requesterUserId, event, 'refund_failed');
  }

  private async createRefund(
    userId: string,
    event: RefundSucceededEvent | RefundFailedEvent,
    kind: 'refund_succeeded' | 'refund_failed',
  ): Promise<void> {
    try {
      const template = renderTemplate(event);
      if (!template) return;
      await this.prisma.notification.create({
        data: {
          userId,
          type: event.type,
          title: template.title,
          body: template.body,
          linkPath: template.linkPath,
        },
      });
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: event.invoiceId },
        select: { collegeId: true },
      });
      if (!invoice) return;
      // M20-W3: refund-success mail links the issued refund document (the
      // page re-authorizes via the API; the link is never an authorization).
      const documentUrl =
        kind === 'refund_succeeded'
          ? await this.refundDocumentUrl(event.attemptId)
          : null;
      await this.mailer.sendToUsers(invoice.collegeId, [userId], ({ firstName }) => ({
        kind,
        firstName,
        amount: event.amount,
        invoiceNo: event.invoiceNo,
        url: this.mailer.absoluteUrl(template.linkPath ?? '/fees'),
        ...(documentUrl ? { receiptUrl: documentUrl } : {}),
      }));
    } catch (error) {
      this.logger.error(
        `refund notification failed: ${(error as Error).constructor.name}`,
      );
    }
  }

  @OnEvent('payment.succeeded')
  async onPaymentSucceeded(event: PaymentSucceededEvent): Promise<void> {
    await this.createPayment(event, 'payment_succeeded');
  }

  @OnEvent('payment.failed')
  async onPaymentFailed(event: PaymentFailedEvent): Promise<void> {
    await this.createPayment(event, 'payment_failed');
  }

  private async createPayment(
    event: PaymentSucceededEvent | PaymentFailedEvent,
    kind: 'payment_succeeded' | 'payment_failed',
  ): Promise<void> {
    try {
      const template = renderTemplate(event);
      if (!template) return;
      await this.prisma.notification.create({
        data: {
          userId: event.studentUserId,
          type: event.type,
          title: template.title,
          body: template.body,
          linkPath: template.linkPath,
        },
      });
      // F4: collegeId anchored to the invoice aggregate.
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: event.invoiceId },
        select: { collegeId: true },
      });
      if (!invoice) return;
      // M20-W3: payment-success mail links the issued receipt.
      const documentUrl =
        kind === 'payment_succeeded'
          ? await this.paymentDocumentUrl(event.attemptId)
          : null;
      await this.mailer.sendToUsers(
        invoice.collegeId,
        [event.studentUserId],
        ({ firstName }) => ({
          kind,
          firstName,
          amount: event.amount,
          invoiceNo: event.invoiceNo,
          url: this.mailer.absoluteUrl(
            template.linkPath ?? '/fees',
          ),
          ...(documentUrl ? { receiptUrl: documentUrl } : {}),
        }),
      );
    } catch (error) {
      this.logger.error(
        `payment notification failed: ${(error as Error).constructor.name}`,
      );
    }
  }

  /** Resolve the settled payment's receipt page URL (null for legacy). */
  private async paymentDocumentUrl(attemptId: string): Promise<string | null> {
    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { id: attemptId },
      select: { paymentId: true },
    });
    if (!attempt?.paymentId) return null;
    const doc = await this.prisma.financeDocument.findUnique({
      where: { paymentId: attempt.paymentId },
      select: { id: true },
    });
    return doc ? this.mailer.absoluteUrl(`/fees/documents/${doc.id}`) : null;
  }

  /** Resolve the refund's document page URL (null for legacy). */
  private async refundDocumentUrl(attemptId: string): Promise<string | null> {
    const attempt = await this.prisma.refundAttempt.findUnique({
      where: { id: attemptId },
      select: { refundId: true },
    });
    if (!attempt?.refundId) return null;
    const doc = await this.prisma.financeDocument.findUnique({
      where: { refundId: attempt.refundId },
      select: { id: true },
    });
    return doc ? this.mailer.absoluteUrl(`/fees/documents/${doc.id}`) : null;
  }

  private async create(
    userId: string,
    event: InvoiceIssuedEvent | InvoiceOverdueEvent,
  ): Promise<void> {
    try {
      const template = renderTemplate(event);
      if (!template) return;
      await this.prisma.notification.create({
        data: {
          userId,
          type: event.type,
          title: template.title,
          body: template.body,
          linkPath: template.linkPath,
        },
      });
      // M12-W2 — email channel (opt-out respected in the mailer).
      // F4: collegeId anchored to the invoice aggregate, not the user id.
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: event.invoiceId },
        select: { collegeId: true },
      });
      if (!invoice) return;
      await this.mailer.sendToUsers(invoice.collegeId, [userId], ({ firstName }) =>
        event.type === 'invoice.issued'
          ? {
              kind: 'invoice_issued',
              firstName,
              amount: event.amount,
              dueDate: event.dueDate,
              url: this.mailer.absoluteUrl(template.linkPath ?? '/fees'),
            }
          : {
              kind: 'invoice_overdue',
              firstName,
              amount: event.amount,
              dueDate: event.dueDate,
              url: this.mailer.absoluteUrl(template.linkPath ?? '/fees'),
            },
      );
    } catch (error) {
      this.logger.error(
        'Failed to create fee notification',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
