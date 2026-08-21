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
    default:
      return null;
  }
}
