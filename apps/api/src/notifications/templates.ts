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
        linkPath: `/fees/invoices/${event.invoiceId}`,
      };
    case 'community.comment':
      return {
        title: 'New comment',
        body: `${event.actorName} commented on your post.`,
        linkPath: `/community?post=${event.postId}`,
      };
    case 'community.like':
      return {
        title: 'New like',
        body: `${event.actorName} liked your post.`,
        linkPath: `/community?post=${event.postId}`,
      };
    case 'community.group_request':
      return {
        title: 'Join request',
        body: `Someone requested to join "${event.groupName}".`,
        linkPath: `/community/groups/${event.groupId}`,
      };
    case 'community.membership_decided':
      return {
        title: event.scope === 'GROUP' ? 'Group membership' : 'Society membership',
        body: event.approved
          ? `You are now a member of "${event.targetName}".`
          : `Your request to join "${event.targetName}" was declined.`,
        linkPath:
          event.scope === 'GROUP'
            ? `/community/groups/${event.targetId}`
            : `/community/societies/${event.targetId}`,
      };
    case 'event.created':
      return {
        title: 'New event',
        body: `"${event.title}" is happening on ${new Date(event.startsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.`,
        linkPath: '/community/events',
      };
    case 'assignment.due_soon':
      return {
        title: 'Assignment due soon',
        body: `"${event.title}" is due ${new Date(event.dueAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`,
        linkPath: `/assignments/${event.assignmentId}`,
      };
    case 'event.reminder':
      return {
        title: 'Event reminder',
        body: `"${event.title}" starts ${new Date(event.startsAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`,
        linkPath: `/community/events?event=${event.eventId}`,
      };
    case 'announcement.published':
      return {
        title: 'Announcement',
        body: event.title,
        linkPath: '/announcements',
      };
    case 'moderation.action_taken':
      switch (event.action) {
        case 'REMOVE_CONTENT':
          return {
            title: 'Content removed',
            body: `Your content was removed by moderation.${event.note ? ` Note: ${event.note}` : ''}`,
            linkPath: '/community',
          };
        case 'RESTORE_CONTENT':
          return {
            title: 'Content restored',
            body: 'Your content was restored by moderation.',
            linkPath: '/community',
          };
        case 'WARN_USER':
          return {
            title: 'Moderation warning',
            body: `You received a warning from moderation.${event.note ? ` Note: ${event.note}` : ''}`,
            linkPath: '/community',
          };
        case 'SUSPEND_COMMUNITY':
          return {
            title: 'Community access suspended',
            body: `Your community access has been suspended.${event.note ? ` Note: ${event.note}` : ''}`,
            linkPath: '/community',
          };
        case 'LIFT_SUSPENSION':
          return {
            title: 'Suspension lifted',
            body: 'Your community access has been restored.',
            linkPath: '/community',
          };
      }
      return null;
    default:
      return null;
  }
}
