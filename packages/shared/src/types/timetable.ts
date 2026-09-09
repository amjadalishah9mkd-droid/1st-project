/** M3 API payload types — timetable & attendance. */

export interface TimetableSlotItem {
  id: string;
  sectionId: string;
  dayOfWeek: number; // 1 = Monday … 7 = Sunday
  startTime: string;
  endTime: string;
  room: string | null;
  courseCode: string;
  courseTitle: string;
  sectionName: string;
  termLabel: string;
  teacherNames: string[];
}

export interface SessionItem {
  id: string;
  slotId: string;
  sectionId: string;
  date: string; // YYYY-MM-DD
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room: string | null;
  status: 'SCHEDULED' | 'HELD' | 'CANCELLED';
  note: string | null;
  takenByName: string | null;
  recordedCount: number;
  enrolledCount: number;
  absentCount: number;
}

export interface AttendanceSheetEntry {
  studentId: string;
  name: string;
  rollNo: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | null;
  note: string | null;
}

export interface AttendanceSheet {
  session: SessionItem;
  courseCode: string;
  sectionName: string;
  entries: AttendanceSheetEntry[];
}

export interface StudentSectionAttendance {
  sectionId: string;
  courseCode: string;
  courseTitle: string;
  sectionName: string;
  termLabel: string;
  held: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  percentage: number | null; // null when no held sessions yet
  /** M21-W2: percentage < college attendanceWarningThreshold (display only). */
  belowThreshold: boolean;
}

export interface SectionAttendanceSummary {
  sectionId: string;
  courseCode: string;
  courseTitle: string;
  sectionName: string;
  held: number;
  students: Array<{
    studentId: string;
    name: string;
    rollNo: string;
    present: number;
    absent: number;
    late: number;
    excused: number;
    percentage: number | null;
    belowThreshold: boolean;
  }>;
}

export type AttendanceSummaryResponse =
  | {
      kind: 'student';
      /** M21-W2: the college's display threshold (read-only surfacing). */
      warningThreshold: number;
      sections: StudentSectionAttendance[];
    }
  | {
      kind: 'section';
      warningThreshold: number;
      summary: SectionAttendanceSummary;
    };
