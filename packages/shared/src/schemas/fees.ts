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
