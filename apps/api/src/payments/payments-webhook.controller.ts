import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.module';
import { PaymentsService } from './payments.service';
import {
  PAYMENT_GATEWAY,
  type PaymentGatewayAdapter,
} from './gateway.adapter';

/**
 * M14-W3 — Safepay webhook endpoint.
 *
 * Deliberately PUBLIC (no CampusOS session): the ONLY authentication is
 * the provider's HMAC signature over the raw body, verified timing-safe
 * by the adapter BEFORE anything is parsed, audited or mutated.
 *
 * Security order: raw bytes → signature → parse → resolve attempt from
 * OUR stored {provider, providerRef} (payload claims never drive tenancy)
 * → GatewayEvent claim (exactly-once) → W1 settlement/failure core.
 *
 * Response discipline: 401 only for authentication failures, 400 only for
 * structurally invalid (but authentic) bodies; every business outcome —
 * duplicate, unknown tracker, amount mismatch — is a 200 so the provider
 * never retry-storms, and none of those responses reveal internal state.
 */
@Controller('payments/webhooks')
export class PaymentsWebhookController {
  private readonly logger = new Logger(PaymentsWebhookController.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayAdapter,
  ) {}

  @Public()
  @Post('safepay')
  @HttpCode(200)
  async safepay(
    @Req() req: RawBodyRequest<Request>,
    // VERIFIED header name (Safepay HMAC docs).
    @Headers('x-sfpy-signature') signature: string | undefined,
  ) {
    const rawBody = req.rawBody;
    if (
      !rawBody ||
      !this.gateway.verifyWebhookSignature(rawBody, signature)
    ) {
      // Indistinguishable for: missing secret config, missing header,
      // bad hex, wrong digest. Nothing was parsed or written.
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid webhook signature',
      });
    }

    const event = this.gateway.parseWebhookEvent(req.body);
    if (!event) {
      // Authentic but structurally unusable — a 4xx we accept retries
      // stopping on, since re-delivery of a malformed body cannot heal.
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Unrecognized webhook payload',
      });
    }

    // Resolve OUR attempt from OUR stored provider identity.
    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: {
        provider_providerRef: {
          provider: this.gateway.provider,
          providerRef: event.providerRef,
        },
      },
    });

    // Idempotency claim FIRST — a redelivered event never re-processes,
    // never re-notifies, and still 200s. The GatewayEvent row doubles as
    // the durable record for unmatched deliveries (AuditLog requires a
    // college, which an unknown tracker by definition lacks).
    const fresh = await this.payments.claimEvent(
      this.gateway.provider,
      event.eventId,
      attempt?.id ?? null,
      attempt ? event.kind : `UNMATCHED_${event.kind}`,
    );
    if (!fresh) {
      return { received: true };
    }

    if (!attempt) {
      this.logger.warn(
        `unmatched ${this.gateway.provider} webhook event ${event.eventId}`,
      );
      return { received: true };
    }

    if (event.kind === 'SUCCEEDED') {
      await this.processSuccess(attempt.id, event.amount, event.currency);
    } else if (event.kind === 'FAILED') {
      await this.processFailure(attempt.id, 'PROVIDER_REPORTED_FAILURE');
    }
    // OTHER (refund/authorization/void event types): recorded in the
    // GatewayEvent ledger above; acted on by W5 reconciliation.
    return { received: true };
  }

  /** Shared with verify-on-return via PaymentsFlowService semantics. */
  private async processSuccess(
    attemptId: string,
    amount: string | null,
    currency: string | null,
  ): Promise<void> {
    try {
      const settled = await this.payments.settleAttempt(attemptId, {
        provider: this.gateway.provider,
        providerRef: (await this.prisma.paymentAttempt.findUniqueOrThrow({
          where: { id: attemptId },
          select: { providerRef: true },
        })).providerRef as string,
        amount: amount ?? '',
        currency: currency ?? '',
      });
      if (settled.justSettled) {
        await this.emitOutcome(attemptId, 'payment.succeeded');
      }
    } catch {
      // AMOUNT_MISMATCH (persisted FAILED by W1) or other business
      // rejection: audit, notify failure once, and 200 — never a retry
      // storm, never a settlement.
      const attempt = await this.prisma.paymentAttempt.findUnique({
        where: { id: attemptId },
      });
      if (attempt) {
        await this.audit.log({
          collegeId: attempt.collegeId,
          actorId: null,
          action: 'payments.webhook_rejected',
          targetType: 'PaymentAttempt',
          targetId: attemptId,
          metadata: {
            provider: this.gateway.provider,
            reason: attempt.failureCode ?? 'SETTLEMENT_REJECTED',
          },
        });
      }
      if (attempt?.failureCode === 'AMOUNT_MISMATCH') {
        await this.emitOutcome(attemptId, 'payment.failed');
      }
    }
  }

  private async processFailure(
    attemptId: string,
    failureCode: string,
  ): Promise<void> {
    const failed = await this.payments.failAttempt(attemptId, failureCode);
    if (failed.justFailed) {
      await this.audit.log({
        collegeId: failed.collegeId,
        actorId: null,
        action: 'payments.attempt_failed',
        targetType: 'PaymentAttempt',
        targetId: attemptId,
        metadata: { provider: this.gateway.provider, reason: failureCode },
      });
      await this.emitOutcome(attemptId, 'payment.failed');
    }
  }

  /** Emit AFTER commits; notification failures never touch money. */
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
