import type { ExamItem } from '@campusos/shared';

export function examStatusTone(
  status: ExamItem['status'],
): 'neutral' | 'brand' | 'warning' | 'success' {
  switch (status) {
    case 'PUBLISHED':
      return 'success';
    case 'COMPLETED':
      return 'warning';
    case 'SCHEDULED':
      return 'brand';
    default:
      return 'neutral';
  }
}
