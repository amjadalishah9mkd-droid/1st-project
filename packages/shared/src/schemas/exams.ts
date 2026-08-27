import { z } from 'zod';

/** Exam & results schemas (M5). Single validation source. */
const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date/time');

export const createExamSchema = z.object({
  termId: z.string().min(1, 'Term is required'),
  title: z.string().trim().min(3, 'Title is required').max(160),
  type: z.enum(['QUIZ', 'MIDTERM', 'FINAL', 'PRACTICAL']),
});
export type CreateExamInput = z.infer<typeof createExamSchema>;

export const updateExamSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  type: z.enum(['QUIZ', 'MIDTERM', 'FINAL', 'PRACTICAL']).optional(),
  // PUBLISHED is only reachable through POST /exams/:id/publish.
  status: z.enum(['DRAFT', 'SCHEDULED', 'COMPLETED']).optional(),
});
export type UpdateExamInput = z.infer<typeof updateExamSchema>;

export const createExamPaperSchema = z.object({
  sectionId: z.string().min(1, 'Section is required'),
  examDate: isoDateTime,
  maxMarks: z.coerce.number().positive('Max marks must be positive').max(1000),
  room: z.string().trim().max(40).optional(),
  weight: z.coerce.number().positive().max(10).optional(), // dormant GPA hook
});
export type CreateExamPaperInput = z.infer<typeof createExamPaperSchema>;

export const updateExamPaperSchema = createExamPaperSchema
  .omit({ sectionId: true })
  .partial();
export type UpdateExamPaperInput = z.infer<typeof updateExamPaperSchema>;

export const saveMarksSchema = z.object({
  marks: z
    .array(
      z.object({
        studentId: z.string().min(1),
        marksObtained: z.coerce.number().min(0, 'Marks cannot be negative'),
      }),
    )
    .min(1, 'Enter at least one mark')
    .max(500),
});
export type SaveMarksInput = z.infer<typeof saveMarksSchema>;

export const gradeBandsUpdateSchema = z.object({
  bands: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(5),
        minPercent: z.coerce.number().min(0).max(100),
        maxPercent: z.coerce.number().min(0).max(100),
      }),
    )
    .min(2, 'At least two bands are required')
    .max(15)
    .refine(
      (bands) =>
        bands.every((band) => band.minPercent <= band.maxPercent),
      'Each band needs minPercent ≤ maxPercent',
    ),
});
export type GradeBandsUpdateInput = z.infer<typeof gradeBandsUpdateSchema>;

export const resultsQuerySchema = z.object({
  studentId: z.string().optional(),
  termId: z.string().optional(),
});

// ── M18-W1: academic result finalization (design §17) ─────────────────
// Typed confirmation = the term label (M15/M17 pattern), validated
// server-side. The client never supplies collegeId, status, version or
// supersession identity.

export const finalizeResultSchema = z.object({
  studentId: z.string().min(1, 'Student is required'),
  confirmLabel: z.string().min(1, 'Type the term label to confirm'),
});
export type FinalizeResultInput = z.infer<typeof finalizeResultSchema>;

export const amendResultSchema = z.object({
  reason: z.string().trim().min(3, 'A reason is required').max(300),
  confirmLabel: z.string().min(1, 'Type the term label to confirm'),
});
export type AmendResultInput = z.infer<typeof amendResultSchema>;

export const finalizeBatchSchema = z.object({
  studentIds: z.array(z.string().min(1)).min(1).max(500),
  confirmLabel: z.string().min(1, 'Type the term label to confirm'),
});
export type FinalizeBatchInput = z.infer<typeof finalizeBatchSchema>;

export const voidResultSchema = z.object({
  reason: z.string().trim().min(3, 'A reason is required').max(300),
  confirmLabel: z.string().min(1, 'Type the term label to confirm'),
});
export type VoidResultInput = z.infer<typeof voidResultSchema>;
