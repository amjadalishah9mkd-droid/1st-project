import type { AssignmentItem } from '@campusos/shared';

export function assignmentStatus(row: AssignmentItem): {
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'brand';
} {
  if (!row.publishedAt) return { label: 'Draft', tone: 'neutral' };
  if (row.mySubmission) {
    if (row.mySubmission.gradedAt) {
      return {
        label: `Graded ${row.mySubmission.points}/${row.maxPoints}`,
        tone: 'success',
      };
    }
    return row.mySubmission.isLate
      ? { label: 'Submitted late', tone: 'warning' }
      : { label: 'Submitted', tone: 'brand' };
  }
  if (new Date(row.dueAt) < new Date()) {
    return row.allowLate
      ? { label: 'Overdue (late allowed)', tone: 'warning' }
      : { label: 'Closed', tone: 'danger' };
  }
  return { label: 'Open', tone: 'success' };
}

export function formatDue(dueAt: string): string {
  return new Date(dueAt).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
