import {
  BadGatewayException,
  Controller,
  ForbiddenException,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { PERMISSIONS } from '@campusos/shared';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';
import { PolicyService } from '../access/policy.service';
import { EventsService } from '../events/events.module';
import {
  PAYMENT_GATEWAY,
  type PaymentGatewayAdapter,
} from './gateway.adapter';

/**
 * M14-W2 — student payment initiation.
 *
 * POST /fees/invoices/:id/pay
 *   PermissionsGuard (payments.initiate) → PaymentsService.createAttempt
 *   (OWN-scoped invoice resolution + server-frozen full outstanding
 *   balance, W1) → gateway hosted-checkout session → markPending →
 *   safe redirect info only.
 *
 * The invoice id is the ONLY client-controlled input: the endpoint takes
 * no body at all, so amounts/currency/ownership are structurally
 * un-tamperable. The browser redirect never settles anything — settlement
 * is exclusively W3's verified-confirmation path.
 */
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
    private readonly events: EventsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayAdapter,
  ) {}

  @Post('fees/invoices/:id/pay')
  @RequirePermission(PERMISSIONS.PAYMENTS_INITIATE)
  async pay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') invoiceId: string,
  ) {
    // W1 core: authorization scope, tenancy, balance freeze, row lock,
    // one-live-attempt guard. Throws 404/400/409 per domain semantics.
    const attempt = await this.payments.createAttempt(
      user,
      invoiceId,
      this.gateway.provider,
    );

    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: attempt.invoiceId },
      select: { invoiceNo: true },
    });
    const appBase = process.env.APP_BASE_URL ?? 'http://localhost:3000';

    let session;
    try {
      session = await this.gateway.createCheckoutSession({
        attemptId: attempt.id,
        amount: attempt.amount.toString(),
        currency: attempt.currency,
        orderRef: invoice.invoiceNo,
        // W4's status page route; safe to point at now.
        redirectUrl: `${appBase}/fees/payments/${attempt.id}`,
        cancelUrl: `${appBase}/fees/payments/${attempt.id}?cancelled=1`,
      });
    } catch (error) {
      // The attempt must accurately reflect that no gateway session
      // exists — nothing here is payable and nothing was settled.
      await this.payments.failAttempt(attempt.id, 'SESSION_CREATE_FAILED');
      throw error;
    }

    try {
      await this.payments.markPending(attempt.id, session.providerRef);
    } catch (error) {
      // Includes the DB unique(provider, providerRef) backstop: one
      // provider reference can never map to two attempts.
      await this.payments.failAttempt(attempt.id, 'PROVIDER_REF_CONFLICT');
      throw new BadGatewayException({
        code: 'GATEWAY_ERROR',
        message: 'The payment session could not be registered',
      });
    }

    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'payments.attempt_initiated',
      targetType: 'Invoice',
      targetId: attempt.invoiceId,
      metadata: {
        attemptId: attempt.id,
        amount: attempt.amount.toString(),
        provider: this.gateway.provider,
      },
    });

    // Safe redirect info only — no provider payloads, no secrets.
    return {
      attemptId: attempt.id,
      status: 'PENDING',
      checkoutUrl: session.checkoutUrl,
    };
  }

  /**
   * M14-W3 — verify-on-return. The browser redirect is NEVER the source
   * of truth: this endpoint asks the PROVIDER (server-to-server) what
   * happened and routes the answer through the same W1 settlement/failure
   * core the webhook uses. A forged "success" redirect settles nothing;
   * a provider-confirmed payment settles even if the browser claimed
   * failure. Amount authority stays with the frozen attempt.
   */
  @Post('payments/attempts/:id/verify')
  @RequirePermission(PERMISSIONS.PAYMENTS_INITIATE)
  async verify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') attemptId: string,
  ) {
    const scope = await this.policy.scopeFor(user, 'payments.initiate');
    if (!scope) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      });
    }
    // Ownership + tenancy: OWN callers see only their own attempts;
    // anything else reads as nonexistent.
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: {
        id: attemptId,
        collegeId: user.collegeId,
        ...(scope === 'OWN' ? { initiatedById: user.id } : {}),
      },
    });
    if (!attempt) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Payment attempt not found',
      });
    }

    // Terminal or not-yet-at-gateway attempts: nothing to ask the provider.
    if (
      attempt.status !== 'PENDING' ||
      attempt.providerRef === null
    ) {
      return this.safeStatus(attempt.id);
    }

    const verification = await this.gateway.verifyPayment(attempt.providerRef);
    if (verification.state === 'PAID') {
      try {
        const settled = await this.payments.settleAttempt(attempt.id, {
          provider: this.gateway.provider,
          providerRef: attempt.providerRef,
          amount: verification.amount,
          currency: verification.currency,
        });
        if (settled.justSettled) {
          await this.emitOutcome(attempt.id, 'payment.succeeded');
        }
      } catch {
        // Amount/currency mismatch — W1 persisted FAILED; fall through to
        // report the truthful state. Never settle on mismatched money.
        const after = await this.prisma.paymentAttempt.findUnique({
          where: { id: attempt.id },
        });
        if (after?.failureCode === 'AMOUNT_MISMATCH') {
          await this.emitOutcome(attempt.id, 'payment.failed');
        }
      }
    } else if (verification.state === 'FAILED') {
      const failed = await this.payments.failAttempt(
        attempt.id,
        'PROVIDER_REPORTED_FAILURE',
      );
      if (failed.justFailed) {
        await this.emitOutcome(attempt.id, 'payment.failed');
      }
    }
    // PENDING: the provider hasn't confirmed — leave the attempt alone.
    return this.safeStatus(attempt.id);
  }

  /** Safe, minimal attempt view for the (future W4) status page. */
  private async safeStatus(attemptId: string) {
    const attempt = await this.prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    return {
      attemptId: attempt.id,
      invoiceId: attempt.invoiceId,
      status: attempt.status,
      amount: attempt.amount.toString(),
      currency: attempt.currency,
    };
  }

  private async emitOutcome(
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
}
