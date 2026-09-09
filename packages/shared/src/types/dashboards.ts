/** M9 API payload types — role dashboards (real aggregates only). */

export interface TodaySessionInfo {
  sessionId: string | null; // null when not yet generated
  sectionId: string;
  sectionLabel: string;
  startTime: string;
  endTime: string;
  room: string | null;
  status: 'SCHEDULED' | 'HELD' | 'CANCELLED' | 'NOT_GENERATED';
}

export interface AdminDashboard {
  students: number;
  teachers: number;
  courses: number;
  sections: number;
  /** College-wide attendance % across held sessions, null when none. */
  attendanceRate: number | null;
  fees: {
    invoiced: string;
    collected: string;
    outstanding: string;
    overdueCount: number;
  };
  openReports: number;
  upcomingEvents: number;
  publishedExams: number;
  currentTermLabel: string | null;
}

export interface TeacherDashboard {
  sections: number;
  students: number;
  todaySessions: TodaySessionInfo[];
  pendingGrading: number;
  openAssignments: number;
  attendanceRate: number | null;
}

export interface StudentDashboard {
  sections: number;
  attendanceRate: number | null;
  todayClasses: TodaySessionInfo[];
  pendingAssignments: Array<{
    id: string;
    title: string;
    courseCode: string;
    dueAt: string;
  }>;
  feeBalance: string;
  overdueInvoices: number;
  publishedResults: number;
  nextEvent: { id: string; title: string; startsAt: string } | null;
}
