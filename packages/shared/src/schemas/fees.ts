import { z } from 'zod';

/** Fee schemas (M6). Single validation source. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

export const feeComponentSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(80),
  amount: z.coerce.number().positive('Amount must be positive').max(1_000_000),
});

export const createFeeStructureSchema = z.object({
  termId: z.string().min(1, 'Term is required'),
  courseId: z.string().min(1).optional(), // absent = college-wide
  name: z.string().trim().min(3, 'Name is required').max(120),
  components: z
    .array(feeComponentSchema)
    .min(1, 'Add at least one component')
    .max(20),
});
export type CreateFeeStructureInput = z.infer<typeof createFeeStructureSchema>;

export const updateFeeStructureSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  components: z.array(feeComponentSchema).min(1).max(20).optional(),
});
export type UpdateFeeStructureInput = z.infer<typeof updateFeeStructureSchema>;

export const generateInvoicesSchema = z.object({
  structureId: z.string().min(1, 'Structure is required'),
  dueDate: isoDate,
});
export type GenerateInvoicesInput = z.infer<typeof generateInvoicesSchema>;

export const recordPaymentSchema = z.object({
  amount: z.coerce.number().positive('Amount must be positive').max(1_000_000),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER']),
  reference: z.string().trim().max(80).optional(),
  paidAt: isoDate.optional(), // defaults to today
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const invoicesQuerySchema = z.object({
  studentId: z.string().optional(),
  status: z
    .enum(['PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED'])
    .optional(),
});

// ── M16-W1: refund contracts (design §19) ─────────────────────────────
// Contracts only — endpoints arrive in M16-W2. The client NEVER supplies
// collegeId, an authoritative invoiceId, provider refund identifiers, or
// any settled amount: the payment is addressed by URL param and everything
// else is resolved server-side. Refundable-balance checks are server/DB
// state and deliberately NOT expressed here (W2).

/** Body of POST /fees/payments/:paymentId/refunds. */
export const createRefundSchema = z.object({
  amount: z.coerce
    .number()
    .positive('Amount must be positive')
    .max(1_000_000),
  currency: z.literal('PKR'),
  reason: z.string().trim().min(3, 'Reason is required').max(300),
  method: z.enum(['PROVIDER', 'RECORDED']),
});
export type CreateRefundInput = z.infer<typeof createRefundSchema>;

/** Body of POST /fees/refunds/:id/execute — typed amount confirmation. */
export const executeRefundSchema = z.object({
  confirmAmount: z.string().trim().min(1, 'Type the refund amount to confirm'),
});
export type ExecuteRefundInput = z.infer<typeof executeRefundSchema>;

/** Body of POST /fees/refunds/:id/cancel. */
export const cancelRefundSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});
export type CancelRefundInput = z.infer<typeof cancelRefundSchema>;

/** Reconciliation-style listing filters (design §21). */
export const refundsQuerySchema = z.object({
  status: z
    .enum(['REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED'])
    .optional(),
  method: z.enum(['PROVIDER', 'RECORDED']).optional(),
  invoiceNo: z.string().trim().max(60).optional(),
});
export type RefundsQueryInput = z.infer<typeof refundsQuerySchema>;
