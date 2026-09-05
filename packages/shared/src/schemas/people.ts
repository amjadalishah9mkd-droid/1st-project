import { z } from 'zod';

/**
 * People schemas (M2). Single validation source for client and server.
 * Dates travel as ISO `yyyy-mm-dd` strings; services convert to Date.
 */
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

const nameField = z.string().trim().min(1, 'Required').max(80);

export const createStudentSchema = z.object({
  firstName: nameField,
  lastName: nameField,
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
  phone: z.string().trim().max(30).optional(),
  departmentId: z.string().min(1, 'Department is required'),
  admissionNo: z.string().trim().min(1, 'Admission number is required').max(40),
  rollNo: z.string().trim().min(1, 'Roll number is required').max(40),
  batch: z.string().trim().min(1, 'Batch is required').max(20),
  dateOfBirth: isoDate.optional(),
  guardianName: z.string().trim().max(120).optional(),
  guardianPhone: z.string().trim().max(30).optional(),
  guardianEmail: z.string().trim().toLowerCase().email().max(254).optional(),
  address: z.string().trim().max(500).optional(),
});
export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export const updateStudentSchema = createStudentSchema
  .omit({ email: true, admissionNo: true })
  .partial()
  .extend({
    status: z
      .enum(['ENROLLED', 'GRADUATED', 'WITHDRAWN', 'SUSPENDED'])
      .optional(),
  });
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;

export const createTeacherSchema = z.object({
  firstName: nameField,
  lastName: nameField,
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
  phone: z.string().trim().max(30).optional(),
  departmentId: z.string().min(1, 'Department is required'),
  employeeNo: z.string().trim().min(1, 'Employee number is required').max(40),
  designation: z.string().trim().min(1, 'Designation is required').max(80),
  qualification: z.string().trim().max(160).optional(),
  joinedOn: isoDate,
});
export type CreateTeacherInput = z.infer<typeof createTeacherSchema>;

export const updateTeacherSchema = createTeacherSchema
  .omit({ email: true, employeeNo: true })
  .partial();
export type UpdateTeacherInput = z.infer<typeof updateTeacherSchema>;

/** One CSV import row (header: firstName,lastName,email,admissionNo,rollNo,batch,departmentCode). */
export const studentImportRowSchema = z.object({
  firstName: nameField,
  lastName: nameField,
  email: z.string().trim().toLowerCase().email('Invalid email').max(254),
  admissionNo: z.string().trim().min(1, 'admissionNo is required').max(40),
  rollNo: z.string().trim().min(1, 'rollNo is required').max(40),
  batch: z.string().trim().min(1, 'batch is required').max(20),
  departmentCode: z.string().trim().min(1, 'departmentCode is required').max(20),
});
export type StudentImportRow = z.infer<typeof studentImportRowSchema>;

/** M13-W2 — guardian invitation (decisions H1–H6). */
export const inviteGuardianSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
  relationship: z.string().trim().min(1, 'Relationship is required').max(40),
});
export type InviteGuardianInput = z.infer<typeof inviteGuardianSchema>;

export interface GuardianLinkItem {
  id: string;
  relationship: string;
  status: 'ACTIVE' | 'REVOKED';
  createdAt: string;
  revokedAt: string | null;
  guardian: { id: string; firstName: string; lastName: string; email: string };
  createdBy: { firstName: string; lastName: string } | null;
}

export interface GuardianChildItem {
  studentProfileId: string;
  firstName: string;
  lastName: string;
  admissionNo: string;
  rollNo: string;
  batch: string;
  departmentName: string;
  relationship: string;
  linkedAt: string;
}
