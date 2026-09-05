/** M4 API payload types — assignments & submissions. */

export interface AssignmentAttachment {
  name: string;
  url: string;
  size: number;
}

export interface AssignmentItem {
  id: string;
  sectionId: string;
  courseCode: string;
  courseTitle: string;
  sectionName: string;
  termLabel: string;
  title: string;
  dueAt: string;
  maxPoints: string;
  allowLate: boolean;
  publishedAt: string | null;
  createdByName: string;
  submissionCount: number;
  gradedCount: number;
  enrolledCount: number;
  /** Present for students: their own submission state. */
  mySubmission: MySubmissionState | null;
}

export interface MySubmissionState {
  id: string;
  submittedAt: string;
  isLate: boolean;
  points: string | null;
  feedback: string | null;
  gradedAt: string | null;
}

export interface AssignmentDetail extends AssignmentItem {
  description: string;
  attachments: AssignmentAttachment[];
  mySubmissionContent: {
    textContent: string | null;
    fileUrl: string | null;
    fileName: string | null;
  } | null;
}

export interface SubmissionListEntry {
  studentId: string;
  studentName: string;
  rollNo: string;
  submission: {
    id: string;
    submittedAt: string;
    isLate: boolean;
    textContent: string | null;
    fileUrl: string | null;
    fileName: string | null;
    points: string | null;
    feedback: string | null;
    gradedAt: string | null;
    gradedByName: string | null;
  } | null;
}

export interface SubmissionList {
  assignmentId: string;
  title: string;
  maxPoints: string;
  dueAt: string;
  entries: SubmissionListEntry[];
}

export interface UploadedFileInfo {
  url: string;
  name: string;
  size: number;
}
