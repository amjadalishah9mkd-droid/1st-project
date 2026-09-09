import { z } from 'zod';

/** Timetable & attendance schemas (M3). Single validation source. */
const timeField = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24h format HH:mm');
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

export const createSlotSchema = z
  .object({
    sectionId: z.string().min(1, 'Section is required'),
    dayOfWeek: z.coerce.number().int().min(1, 'Choose a day').max(7),
    startTime: timeField,
    endTime: timeField,
    room: z.string().trim().max(40).optional(),
  })
  .refine((data) => data.startTime < data.endTime, {
    message: 'End time must be after the start time',
    path: ['endTime'],
  });
export type CreateSlotInput = z.infer<typeof createSlotSchema>;

export const updateSlotSchema = z
  .object({
    dayOfWeek: z.coerce.number().int().min(1).max(7).optional(),
    startTime: timeField.optional(),
    endTime: timeField.optional(),
    room: z.string().trim().max(40).optional(),
  })
  .refine(
    (data) =>
      !data.startTime || !data.endTime || data.startTime < data.endTime,
    { message: 'End time must be after the start time', path: ['endTime'] },
  );
export type UpdateSlotInput = z.infer<typeof updateSlotSchema>;

export const generateSessionsQuerySchema = z.object({
  weekOf: isoDate,
});

export const updateSessionSchema = z.object({
  status: z.enum(['SCHEDULED', 'HELD', 'CANCELLED']),
  note: z.string().trim().max(500).optional(),
});
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;

export const attendanceStatusSchema = z.enum([
  'PRESENT',
  'ABSENT',
  'LATE',
  'EXCUSED',
]);

export const saveAttendanceSchema = z.object({
  records: z
    .array(
      z.object({
        studentId: z.string().min(1),
        status: attendanceStatusSchema,
        note: z.string().trim().max(300).optional(),
      }),
    )
    .min(1, 'At least one attendance record is required')
    .max(500),
});
export type SaveAttendanceInput = z.infer<typeof saveAttendanceSchema>;

export const sessionsListQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const attendanceSummaryQuerySchema = z.object({
  studentId: z.string().optional(),
  sectionId: z.string().optional(),
  termId: z.string().optional(),
});
