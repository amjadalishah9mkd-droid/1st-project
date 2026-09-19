/** M5 API payload types — exams, marks, results. */

export interface ExamItem {
  id: string;
  termId: string;
  termLabel: string;
  title: string;
  type: 'QUIZ' | 'MIDTERM' | 'FINAL' | 'PRACTICAL';
  status: 'DRAFT' | 'SCHEDULED' | 'COMPLETED' | 'PUBLISHED';
  publishedAt: string | null;
  paperCount: number;
  markCount: number;
}

export interface ExamPaperItem {
  id: string;
  examId: string;
  sectionId: string;
  courseCode: string;
  courseTitle: string;
  sectionName: string;
  examDate: string;
  maxMarks: string;
  room: string | null;
  enrolledCount: number;
  markCount: number;
  /** Whether the caller may enter marks for this paper (ASSIGNED/ALL). */
  canEnterMarks: boolean;
}

export interface ExamDetail extends ExamItem {
  papers: ExamPaperItem[];
}

export interface MarksSheet {
  paper: ExamPaperItem;
  examTitle: string;
  examStatus: string;
  locked: boolean;
  entries: Array<{
    studentId: string;
    name: string;
    rollNo: string;
    marksObtained: string | null;
  }>;
}

export interface ResultRow {
  examId: string;
  examTitle: string;
  examType: string;
  courseCode: string;
  courseTitle: string;
  sectionName: string;
  marksObtained: string;
  maxMarks: string;
  percentage: number;
  bandLabel: string | null;
}

export interface ResultsResponse {
  studentId: string;
  studentName: string;
  termId: string | null;
  termLabel: string | null;
  rows: ResultRow[];
  overall: {
    obtained: string;
    max: string;
    percentage: number | null;
    bandLabel: string | null;
  };
}

export interface ExamAnalytics {
  examId: string;
  title: string;
  status: string;
  papers: Array<{
    paperId: string;
    courseCode: string;
    sectionName: string;
    maxMarks: string;
    markCount: number;
    average: number | null;
    highest: number | null;
    lowest: number | null;
  }>;
  bandDistribution: Array<{ label: string; count: number }>;
}

export interface GradeBandItem {
  id: string;
  label: string;
  minPercent: string;
  maxPercent: string;
  sortOrder: number;
}
