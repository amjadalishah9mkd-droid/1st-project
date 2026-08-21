import { z } from 'zod';

/** Timetable & attendance schemas (M3). Single validation source. */
const timeField = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24h format HH:mm');
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

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
