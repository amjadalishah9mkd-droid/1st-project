'use client';

/**
 * M18-W3 — shared academic-record rendering (report card + transcript).
 * Pure presentation over the W2 APIs: the backend owns every academic
 * value (grades, GPA, CGPA, pass/fail) — nothing is recalculated here.
 * Null GPA/grade-point values render as "Not configured" (the
 * institutional grade-point scale gap), never as a fabricated number.
 * Print output reuses the M12-W3 browser-print pattern (window.print()
 * + print CSS) — no PDF dependency.
 */

export interface CourseLine {
  courseCode: string;
  courseTitle: string;
  credits: number;
  obtained: string;
  maxMarks: string;
  percentage: string;
  gradeLabel: string | null;
  gradePoint: string | null;
  passed: boolean | null;
}

export interface TermRecord {
  id: string;
  termId: string;
  status: string;
  version: number;
  overallPercentage: string;
  gradeLabel: string | null;
  gradePoint: string | null;
  termGpa: string | null;
  creditsAttempted: number;
  creditsEarned: number | null;
  attendancePercent: string | null;
  finalizedAt: string;
  courses: CourseLine[];
}

export function gpaOrNotConfigured(value: string | null): string {
  return value ?? 'Not configured';
}

export function CourseTable({ courses }: { courses: CourseLine[] }) {
  return (
    <table className="mt-4 w-full border-collapse text-sm">
      <thead>
        <tr className="border-b-2 border-ink text-left">
          <th className="py-2 pr-3">Course</th>
          <th className="py-2 pr-3 text-right">Credits</th>
          <th className="py-2 pr-3 text-right">Marks</th>
          <th className="py-2 pr-3 text-right">Max</th>
          <th className="py-2 pr-3 text-right">%</th>
          <th className="py-2 pr-3 text-right">Grade</th>
          <th className="py-2 text-right">Points</th>
        </tr>
      </thead>
      <tbody>
        {courses.map((course) => (
          <tr key={course.courseCode} className="border-b border-line break-inside-avoid">
            <td className="py-2 pr-3">
              <span className="font-medium">{course.courseCode}</span>{' '}
              <span className="text-ink-muted">{course.courseTitle}</span>
            </td>
            <td className="py-2 pr-3 text-right">{course.credits}</td>
            <td className="py-2 pr-3 text-right">{course.obtained}</td>
            <td className="py-2 pr-3 text-right">{course.maxMarks}</td>
            <td className="py-2 pr-3 text-right">{course.percentage}</td>
            <td className="py-2 pr-3 text-right font-medium">
              {course.gradeLabel ?? '—'}
            </td>
            <td className="py-2 text-right">{course.gradePoint ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TermSummaryRow({ record }: { record: TermRecord }) {
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
      <div>
        <dt className="text-xs uppercase tracking-wide text-ink-muted">Overall</dt>
        <dd className="font-semibold">{record.overallPercentage}%</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-ink-muted">Grade</dt>
        <dd className="font-semibold">{record.gradeLabel ?? '—'}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-ink-muted">Term GPA</dt>
        <dd className="font-semibold">{gpaOrNotConfigured(record.termGpa)}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-ink-muted">Credits</dt>
        <dd className="font-semibold">
          {record.creditsEarned !== null
            ? `${record.creditsEarned} / ${record.creditsAttempted}`
            : record.creditsAttempted}
        </dd>
      </div>
    </dl>
  );
}
