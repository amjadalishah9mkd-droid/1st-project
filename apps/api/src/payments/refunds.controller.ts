import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  cancelRefundSchema,
  createRefundSchema,
  executeRefundSchema,
  refundsQuerySchema,
  PERMISSIONS,
  type CancelRefundInput,
  type CreateRefundInput,
  type ExecuteRefundInput,
  type RefundsQueryInput,
} from '@campusos/shared';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RefundsService } from './refunds.service';

/**
 * M16-W2 — refund HTTP surface (thin; all logic in RefundsService).
 * Mutations: finance.refund (ADMIN + ACCOUNTANT via W1 grants — D-1).
 * Reads: existing finance permission model (fees.read / fees.manage-ALL).
 * The client NEVER supplies collegeId, an authoritative invoiceId, provider
 * identifiers, or amounts after creation.
 */
@Controller()
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Post('fees/payments/:id/refunds')
  @RequirePermission(PERMISSIONS.FINANCE_REFUND)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') paymentId: string,
    @Body(new ZodValidationPipe(createRefundSchema)) body: CreateRefundInput,
  ) {
    return this.refunds.create(user, paymentId, body);
  }

  @Get('fees/payments/:id/refunds')
  @RequirePermission(PERMISSIONS.FEES_READ)
  summary(@CurrentUser() user: AuthenticatedUser, @Param('id') paymentId: string) {
    return this.refunds.paymentSummary(user, paymentId);
  }

  @Get('fees/refunds')
  @RequirePermission(PERMISSIONS.FEES_MANAGE)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(refundsQuerySchema)) query: RefundsQueryInput,
  ) {
    return this.refunds.list(user, query);
  }

  @Post('fees/refunds/:id/execute')
  @RequirePermission(PERMISSIONS.FINANCE_REFUND)
  execute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') attemptId: string,
    @Body(new ZodValidationPipe(executeRefundSchema)) body: ExecuteRefundInput,
  ) {
    return this.refunds.execute(user, attemptId, body.confirmAmount);
  }

  @Post('fees/refunds/:id/cancel')
  @RequirePermission(PERMISSIONS.FINANCE_REFUND)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') attemptId: string,
    @Body(new ZodValidationPipe(cancelRefundSchema)) _body: CancelRefundInput,
  ) {
    return this.refunds.cancel(user, attemptId);
  }

  @Post('fees/refunds/:id/verify')
  @RequirePermission(PERMISSIONS.FINANCE_REFUND)
  verify(@CurrentUser() user: AuthenticatedUser, @Param('id') attemptId: string) {
    return this.refunds.verify(user, attemptId);
  }
}
