import { z } from 'zod';

/** Academic structure schemas (M2). Single validation source. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

const dateOrder = (data: { startsOn: string; endsOn: string }) =>
  new Date(data.startsOn).getTime() < new Date(data.endsOn).getTime();

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'Code is required')
    .max(20)
    .regex(/^[A-Z0-9-]+$/, 'Letters, digits and dashes only'),
  headTeacherId: z.string().min(1).optional().nullable(),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = createDepartmentSchema
  .omit({ code: true })
  .partial();
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

export const createCourseSchema = z.object({
  departmentId: z.string().min(1, 'Department is required'),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'Code is required')
    .max(20)
    .regex(/^[A-Z0-9-]+$/, 'Letters, digits and dashes only'),
  title: z.string().trim().min(2, 'Title is required').max(160),
  credits: z.coerce.number().int().min(1, 'Min 1 credit').max(12),
  description: z.string().trim().max(2000).optional(),
});
export type CreateCourseInput = z.infer<typeof createCourseSchema>;

export const updateCourseSchema = createCourseSchema
  .omit({ code: true })
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() });
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;

export const createAcademicYearSchema = z
  .object({
    label: z.string().trim().min(4, 'Label is required').max(40),
    startsOn: isoDate,
    endsOn: isoDate,
  })
  .refine(dateOrder, {
    message: 'End date must be after the start date',
    path: ['endsOn'],
  });
export type CreateAcademicYearInput = z.infer<typeof createAcademicYearSchema>;

export const updateAcademicYearSchema = z
  .object({
    label: z.string().trim().min(4).max(40).optional(),
    startsOn: isoDate.optional(),
    endsOn: isoDate.optional(),
  })
  .refine(
    (data) =>
      !data.startsOn ||
      !data.endsOn ||
      dateOrder(data as { startsOn: string; endsOn: string }),
    { message: 'End date must be after the start date', path: ['endsOn'] },
  );
export type UpdateAcademicYearInput = z.infer<typeof updateAcademicYearSchema>;

export const createTermSchema = z
  .object({
    academicYearId: z.string().min(1, 'Academic year is required'),
    label: z.string().trim().min(2, 'Label is required').max(40),
    startsOn: isoDate,
    endsOn: isoDate,
  })
  .refine(dateOrder, {
    message: 'End date must be after the start date',
    path: ['endsOn'],
  });
export type CreateTermInput = z.infer<typeof createTermSchema>;

export const updateTermSchema = z
  .object({
    label: z.string().trim().min(2).max(40).optional(),
    startsOn: isoDate.optional(),
    endsOn: isoDate.optional(),
  })
  .refine(
    (data) =>
      !data.startsOn ||
      !data.endsOn ||
      dateOrder(data as { startsOn: string; endsOn: string }),
    { message: 'End date must be after the start date', path: ['endsOn'] },
  );
export type UpdateTermInput = z.infer<typeof updateTermSchema>;

export const createSectionSchema = z.object({
  courseId: z.string().min(1, 'Course is required'),
  termId: z.string().min(1, 'Term is required'),
  name: z.string().trim().min(1, 'Name is required').max(20),
  capacity: z.coerce.number().int().min(1, 'Capacity must be positive').max(500),
  room: z.string().trim().max(40).optional(),
});
export type CreateSectionInput = z.infer<typeof createSectionSchema>;

export const updateSectionSchema = createSectionSchema
  .omit({ courseId: true, termId: true })
  .partial();
export type UpdateSectionInput = z.infer<typeof updateSectionSchema>;

export const assignTeacherSchema = z.object({
  isPrimary: z.boolean().optional().default(false),
});
export type AssignTeacherInput = z.infer<typeof assignTeacherSchema>;
