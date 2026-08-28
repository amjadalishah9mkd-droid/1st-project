/** M2 API response types — Academic Core payloads. */

export interface DepartmentItem {
  id: string;
  name: string;
  code: string;
  headTeacherId: string | null;
  headTeacherName: string | null;
  courseCount: number;
  teacherCount: number;
  studentCount: number;
}

export interface CourseItem {
  id: string;
  code: string;
  title: string;
  credits: number;
  description: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  sectionCount: number;
}

export interface AcademicYearItem {
  id: string;
  label: string;
  startsOn: string;
  endsOn: string;
  termCount: number;
}

export interface TermItem {
  id: string;
  academicYearId: string;
  academicYearLabel: string;
  label: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
  /** M17-W1: lifecycle state — CLOSED terms are read-only for academics. */
  status: 'ACTIVE' | 'CLOSED';
  sectionCount: number;
}

export interface SectionItem {
  id: string;
  name: string;
  capacity: number;
  room: string | null;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  departmentName: string;
  termId: string;
  termLabel: string;
  enrolledCount: number;
  teacherNames: string[];
}

export interface StudentItem {
  id: string; // StudentProfile id
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  status: string;
  userStatus: string;
  admissionNo: string;
  rollNo: string;
  batch: string;
  departmentId: string;
  departmentName: string;
  enrollmentCount: number;
}

export interface StudentDetail extends StudentItem {
  dateOfBirth: string | null;
  // Emergency-contact fields (M19-W2/O-2): historical "guardian*" names are
  // kept for API compatibility, but these values are contact info only and
  // never grant guardian access (GuardianLink is authoritative). Null unless
  // the caller has full users.read scope or is the student themself.
  guardianName: string | null;
  guardianPhone: string | null;
  guardianEmail: string | null;
  address: string | null;
  enrollments: Array<{
    id: string;
    sectionId: string;
    sectionName: string;
    courseCode: string;
    courseTitle: string;
    termLabel: string;
    status: string;
    enrolledAt: string;
  }>;
}

export interface TeacherItem {
  id: string; // TeacherProfile id
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  userStatus: string;
  employeeNo: string;
  designation: string;
  qualification: string | null;
  joinedOn: string;
  departmentId: string;
  departmentName: string;
  sectionCount: number;
}

export interface TeacherDetail extends TeacherItem {
  assignments: Array<{
    id: string;
    sectionId: string;
    sectionName: string;
    courseCode: string;
    courseTitle: string;
    termLabel: string;
    isPrimary: boolean;
  }>;
}

export interface SectionOverview {
  id: string;
  name: string;
  capacity: number;
  room: string | null;
  course: {
    id: string;
    code: string;
    title: string;
    credits: number;
    status: string;
  };
  department: { id: string; name: string; code: string };
  term: { id: string; label: string; isCurrent: boolean };
  enrolledCount: number;
  teachers: Array<{
    assignmentId: string;
    teacherId: string;
    userId: string;
    name: string;
    designation: string;
    isPrimary: boolean;
  }>;
  students: Array<{
    enrollmentId: string;
    studentId: string;
    userId: string;
    name: string;
    rollNo: string;
    admissionNo: string;
    status: string;
  }>;
  /** Timetable slots for this section — empty until M3 creates them. */
  timetableSlots: Array<{
    id: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    room: string | null;
  }>;
}

export interface StudentImportSummary {
  created: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
  createdStudents: Array<{
    row: number;
    email: string;
    admissionNo: string;
    /** Path-only invitation link (M10-W2); no plaintext passwords. */
    inviteUrl: string;
    inviteExpiresAt: string;
  }>;
}

// ── M15-W2: rollover preview contracts (consumed by the W3 wizard) ──

export interface RolloverStudentPreview {
  studentId: string;
  name: string;
  rollNo: string;
  /** Profile status at preview time. */
  status: 'ENROLLED' | 'GRADUATED' | 'WITHDRAWN' | 'SUSPENDED';
  decision: 'CARRY' | 'HOLD' | 'EXCLUDE';
  holdSourceSectionId: string | null;
  /** D8: SUSPENDED students carried by default but flagged. */
  flagged: boolean;
  /** WITHDRAWN/GRADUATED: excluded automatically, not overridable. */
  locked: boolean;
}

export interface RolloverSectionPreview {
  sourceSectionId: string;
  sourceName: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  action: 'CLONE' | 'MAP' | 'SKIP';
  targetCourseId: string | null;
  targetCourseCode: string | null;
  targetName: string;
  graduateStudents: boolean;
  carryTeachers: boolean;
  teachers: Array<{ teacherId: string; name: string; carried: boolean }>;
  students: RolloverStudentPreview[];
}

export interface RolloverPreview {
  id: string;
  status: 'DRAFT' | 'EXECUTED';
  fromTermId: string;
  fromTermLabel: string;
  toTermId: string;
  toTermLabel: string;
  sections: RolloverSectionPreview[];
  summary: {
    sectionsToCreate: number;
    enrollmentsToCreate: number;
    holds: number;
    excluded: number;
    graduates: number;
    suspendedFlags: number;
  };
  counters: Record<string, number> | null;
  executedAt: string | null;
  /** M17-W1 (D-4): present only when execute was called with closeSourceTerm. */
  sourceTermClosed?: boolean;
  sourceTermCloseError?: string | null;
}
