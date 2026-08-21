import { z } from 'zod';

/**
 * People schemas (M2). Single validation source for client and server.
 * Dates travel as ISO `yyyy-mm-dd` strings; services convert to Date.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

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
