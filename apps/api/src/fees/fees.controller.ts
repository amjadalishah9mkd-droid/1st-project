import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createFeeStructureSchema,
  generateInvoicesSchema,
  invoicesQuerySchema,
  paginationQuerySchema,
  recordPaymentSchema,
  updateFeeStructureSchema,
  PERMISSIONS,
  type CreateFeeStructureInput,
  type GenerateInvoicesInput,
  type RecordPaymentInput,
  type UpdateFeeStructureInput,
} from '@campusos/shared';
import { z } from 'zod';
import { FeesService } from './fees.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

const invoiceListSchema = paginationQuerySchema.merge(invoicesQuerySchema);

@Controller('fees')
export class FeesController {
  constructor(private readonly fees: FeesService) {}

  // ── Structures (admin) ─────────────────────────────────────

  @Get('structures')
  @RequirePermission(PERMISSIONS.FEES_MANAGE)
  listStructures(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(paginationQuerySchema))
    query: z.infer<typeof paginationQuerySchema>,
  ) {
    return this.fees.listStructures(user, query);
  }

  @Post('structures')
  @RequirePermission(PERMISSIONS.FEES_MANAGE)
  createStructure(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createFeeStructureSchema))
    body: CreateFeeStructureInput,
  ) {
    return this.fees.createStructure(user, body);
  }

  @Patch('structures/:id')
  @RequirePermission(PERMISSIONS.FEES_MANAGE)
  updateStructure(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateFeeStructureSchema))
    body: UpdateFeeStructureInput,
  ) {
    return this.fees.updateStructure(user, id, body);
  }

  // ── Invoices ───────────────────────────────────────────────

  @Post('invoices/generate')
  @RequirePermission(PERMISSIONS.FEES_MANAGE)
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(generateInvoicesSchema))
    body: GenerateInvoicesInput,
  ) {
    return this.fees.generateInvoices(user, body);
  }

  @Get('invoices')
  @RequirePermission(PERMISSIONS.FEES_READ)
  listInvoices(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(invoiceListSchema))
    query: z.infer<typeof invoiceListSchema>,
  ) {
    return this.fees.listInvoices(user, query);
  }

  @Get('summary')
  @RequirePermission(PERMISSIONS.FEES_MANAGE)
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.fees.summary(user);
  }

  @Get('invoices/:id')
  @RequirePermission(PERMISSIONS.FEES_READ)
  invoiceDetail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.fees.invoiceDetail(user, id);
  }

  @Patch('invoices/:id/cancel')
  @RequirePermission(PERMISSIONS.FEES_MANAGE)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.fees.cancelInvoice(user, id);
  }

  @Post('invoices/:id/payments')
  @RequirePermission(PERMISSIONS.FEES_MANAGE)
  recordPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(recordPaymentSchema)) body: RecordPaymentInput,
  ) {
    return this.fees.recordPayment(user, id, body);
  }
}
