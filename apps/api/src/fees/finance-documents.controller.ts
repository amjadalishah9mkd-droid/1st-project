import { Body, Controller, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { PERMISSIONS } from '@campusos/shared';
import { FinanceDocumentsService } from './finance-documents.service';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../access/authenticated-user';

const voidSchema = z.object({ reason: z.string().trim().min(5).max(500) });

/**
 * M20-W1 — finance-document mutation foundation (fees.manage only).
 * New settlements/refunds issue documents automatically inside their money
 * transactions; these endpoints cover HISTORICAL (pre-M20) rows and the
 * void transition. The read API is M20-W2 — deliberately absent here.
 */
@Controller('fees')
export class FinanceDocumentsController {
  constructor(private readonly documents: FinanceDocumentsService) {}

  @Post('payments/:paymentId/receipt')
  @RequirePermission(PERMISSIONS.FEES_MANAGE)
  issueReceipt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentId') paymentId: string,
  ) {
    return this.documents.issueReceiptForPayment(user, paymentId);
  }

  @Post('refunds/:refundId/document')
  @RequirePermission(PERMISSIONS.FEES_MANAGE)
  issueRefundDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('refundId') refundId: string,
  ) {
    return this.documents.issueDocumentForRefund(user, refundId);
  }

  @Post('documents/:id/void')
  @RequirePermission(PERMISSIONS.FEES_MANAGE)
  voidDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(voidSchema)) body: { reason: string },
  ) {
    return this.documents.voidDocument(user, id, body.reason);
  }
}
