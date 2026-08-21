import { z } from 'zod';

/** Assignment schemas (M4). Single validation source. */
const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date/time');

export const attachmentSchema = z.object({
  name: z.string().trim().min(1).max(255),
  url: z.string().trim().min(1).max(500),
  size: z.coerce.number().int().min(0),
});
export type AttachmentInput = z.infer<typeof attachmentSchema>;

export const createAssignmentSchema = z.object({
  sectionId: z.string().min(1, 'Section is required'),
  title: z.string().trim().min(3, 'Title is required').max(200),
  description: z.string().trim().min(1, 'Description is required').max(10000),
  dueAt: isoDateTime,
  maxPoints: z.coerce
    .number()
    .positive('Max points must be positive')
    .max(1000),
  allowLate: z.coerce.boolean().default(false),
  attachments: z.array(attachmentSchema).max(10).default([]),
});
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;

export const updateAssignmentSchema = createAssignmentSchema
  .omit({ sectionId: true })
  .partial();
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;

export const submitAssignmentSchema = z
  .object({
    textContent: z.string().trim().max(20000).optional(),
    fileUrl: z.string().trim().max(500).optional(),
    fileName: z.string().trim().max(255).optional(),
  })
  .refine(
    (data) => Boolean(data.textContent?.length) || Boolean(data.fileUrl),
    { message: 'Provide text or attach a file', path: ['textContent'] },
  )
  .refine((data) => !data.fileUrl || Boolean(data.fileName), {
    message: 'File name is required with a file',
    path: ['fileName'],
  });
export type SubmitAssignmentInput = z.infer<typeof submitAssignmentSchema>;

export const gradeSubmissionSchema = z.object({
  points: z.coerce.number().min(0, 'Points cannot be negative').max(1000),
  feedback: z.string().trim().max(5000).optional(),
});
export type GradeSubmissionInput = z.infer<typeof gradeSubmissionSchema>;
