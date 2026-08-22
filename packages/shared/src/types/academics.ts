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
