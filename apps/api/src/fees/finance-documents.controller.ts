import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { PERMISSIONS, paginationQuerySchema } from '@campusos/shared';
import { FinanceDocumentsService } from './finance-documents.service';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../access/authenticated-user';

const voidSchema = z.object({ reason: z.string().trim().min(5).max(500) });

const listQuerySchema = paginationQuerySchema.merge(
  z.object({
    studentId: z.string().trim().min(1).optional(),
    invoiceId: z.string().trim().min(1).optional(),
    kind: z.enum(['PAYMENT_RECEIPT', 'REFUND_DOCUMENT']).optional(),
  }),
);
type ListQuery = z.infer<typeof listQuerySchema>;

/**
 * M20-W1/W2 — finance documents.
 * Mutations (historical issuance, void) are fees.manage; reads are
 * fees.read with the exact invoice scope semantics (ALL / OWN / CHILD via
 * ACTIVE GuardianLink). Reads return the frozen issuance snapshot only —
 * never live data. Print UI is M20-W3 — deliberately absent here.
 */
@Controller('fees')
export class FinanceDocumentsController {
  constructor(private readonly documents: FinanceDocumentsService) {}

  @Get('documents')
  @RequirePermission(PERMISSIONS.FEES_READ)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ) {
    return this.documents.list(user, query);
  }

  @Get('documents/:id')
  @RequirePermission(PERMISSIONS.FEES_READ)
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.documents.detail(user, id);
  }

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
