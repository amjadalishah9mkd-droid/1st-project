import { z } from 'zod';

/** Academic structure schemas (M2). Single validation source. */
// M24-W1 (N-5): the regex is syntactic only — it accepted impossible dates
// like 2024-13-45 and 2024-02-30, which reached Prisma as `Invalid Date`
// (a 500) and, in attendance session generation, made every NaN comparison
// false and bypassed the OUTSIDE_TERM guard. The round-trip check rejects
// any value the calendar cannot represent exactly: `2024-02-30` normalizes
// to March 1 and therefore no longer re-serializes to the input, while real
// dates (including leap days such as 2024-02-29) round-trip unchanged.
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, 'Not a real calendar date');

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

// ── M15-W2: term rollover plan (D1–D8 locked decisions) ─────────────

export const rolloverStudentDecisionSchema = z.object({
  studentId: z.string().min(1),
  decision: z.enum(['CARRY', 'HOLD', 'EXCLUDE']),
  /** For HOLD: the SOURCE section id of another plan entry whose
   * destination section will receive this student (repeat section). */
  holdSourceSectionId: z.string().optional(),
});

export const rolloverSectionPlanSchema = z.object({
  sourceSectionId: z.string().min(1),
  /** CLONE = same course; MAP = different course; SKIP = do not carry. */
  action: z.enum(['CLONE', 'MAP', 'SKIP']),
  targetCourseId: z.string().optional(), // required when action=MAP
  targetName: z.string().trim().min(1).max(40).optional(),
  /** D3: students of this section graduate instead of being enrolled. */
  graduateStudents: z.boolean().default(false),
  /** D4: carry teaching assignments to the destination section. */
  carryTeachers: z.boolean().default(true),
  /** Override teacher set (teacher profile ids); defaults to source. */
  teacherIds: z.array(z.string()).max(20).optional(),
  students: z.array(rolloverStudentDecisionSchema).max(2000).default([]),
});

export const rolloverPlanSchema = z.object({
  sections: z.array(rolloverSectionPlanSchema).max(200),
});
export type RolloverPlanInput = z.infer<typeof rolloverPlanSchema>;

export const createRolloverSchema = z.object({
  fromTermId: z.string().min(1, 'Source term is required'),
});
export type CreateRolloverInput = z.infer<typeof createRolloverSchema>;

/** M17-W1 — term close/reopen typed confirmation (rollover pattern). */
export const termLifecycleSchema = z.object({
  confirmLabel: z.string().min(1, 'Type the term label to confirm'),
});
export type TermLifecycleInput = z.infer<typeof termLifecycleSchema>;

export const executeRolloverSchema = z.object({
  /** Typed confirmation: must equal the destination term label exactly. */
  confirmLabel: z.string().min(1),
  // M17-W1 (D-4): EXPLICIT opt-in only — rollover never closes silently.
  closeSourceTerm: z.boolean().optional(),
});
export type ExecuteRolloverInput = z.infer<typeof executeRolloverSchema>;
