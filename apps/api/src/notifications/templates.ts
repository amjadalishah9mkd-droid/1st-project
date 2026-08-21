import type { DomainEvent } from '@campusos/shared';

export interface NotificationTemplate {
  title: string;
  body: string;
  linkPath: string | null;
}

/**
 * Notification template registry (Blueprint §10).
 * Each supported event type renders to { title, body, linkPath }.
 * The registry grows per milestone as modules start emitting events.
 */
export function renderTemplate(event: DomainEvent): NotificationTemplate | null {
  switch (event.type) {
    case 'attendance.marked_absent':
      return {
        title: 'Marked absent',
        body: `You were marked absent in ${event.sectionName} on ${event.date}.`,
        linkPath: '/attendance',
      };
    case 'assignment.published':
      return {
        title: 'New assignment',
        body: `"${event.title}" is due ${new Date(event.dueAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.`,
        linkPath: `/assignments/${event.assignmentId}`,
      };
    case 'assignment.graded':
      return {
        title: 'Assignment graded',
        body: `"${event.assignmentTitle}" was graded: ${event.points}/${event.maxPoints}.`,
        linkPath: `/assignments/${event.assignmentId}`,
      };
    case 'results.published':
      return {
        title: 'Results published',
        body: `Results for "${event.examTitle}" are now available.`,
        linkPath: '/results',
      };
    case 'invoice.issued':
      return {
        title: 'New fee invoice',
        body: `An invoice of ${event.amount} is due by ${event.dueDate}.`,
        linkPath: '/fees',
      };
    case 'invoice.overdue':
      return {
        title: 'Invoice overdue',
        body: `An invoice of ${event.amount} was due on ${event.dueDate} and is now overdue.`,
        linkPath: '/fees',
      };
    default:
      return null;
  }
}
