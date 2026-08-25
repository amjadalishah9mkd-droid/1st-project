import {
  BadGatewayException,
  Controller,
  Inject,
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
}
