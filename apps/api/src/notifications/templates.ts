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
    default:
      return null;
  }
}
