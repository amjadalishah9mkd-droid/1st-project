/**
 * DomainEvent contracts (Blueprint §10).
 * Every emitter and every notification listener compiles against this union.
 * Events are emitted AFTER the owning database transaction commits.
 */

export interface AttendanceMarkedAbsentEvent {
  type: 'attendance.marked_absent';
  studentUserId: string;
  sessionId: string;
  sectionName: string;
  date: string; // ISO date
}

export interface AssignmentPublishedEvent {
  type: 'assignment.published';
  sectionId: string;
  assignmentId: string;
  title: string;
  dueAt: string;
}

export interface AssignmentGradedEvent {
  type: 'assignment.graded';
  studentUserId: string;
  assignmentId: string;
  assignmentTitle: string;
  points: string;
  maxPoints: string;
}

export interface AssignmentDueSoonEvent {
  type: 'assignment.due_soon';
  assignmentId: string;
  title: string;
  dueAt: string;
  studentUserIds: string[];
}

export interface ResultsPublishedEvent {
  type: 'results.published';
  examId: string;
  examTitle: string;
  studentUserIds: string[];
}

export interface InvoiceIssuedEvent {
  type: 'invoice.issued';
  studentUserId: string;
  invoiceId: string;
  amount: string;
  dueDate: string;
}

export interface InvoiceOverdueEvent {
  type: 'invoice.overdue';
  studentUserId: string;
  invoiceId: string;
  amount: string;
  dueDate: string;
}

export interface CommunityCommentEvent {
  type: 'community.comment';
  actorUserId: string;
  actorName: string;
  targetOwnerUserId: string;
  postId: string;
}

export interface CommunityLikeEvent {
  type: 'community.like';
  actorUserId: string;
  actorName: string;
  targetOwnerUserId: string;
  postId: string;
}

export interface GroupRequestEvent {
  type: 'community.group_request';
  groupId: string;
  groupName: string;
  requesterUserId: string;
  moderatorUserIds: string[];
}

export interface MembershipDecidedEvent {
  type: 'community.membership_decided';
  scope: 'GROUP' | 'SOCIETY';
  targetId: string;
  targetName: string;
  memberUserId: string;
  approved: boolean;
}

export interface EventCreatedEvent {
  type: 'event.created';
  eventId: string;
  title: string;
  startsAt: string;
  societyId: string | null;
}

export interface EventReminderEvent {
  type: 'event.reminder';
  eventId: string;
  title: string;
  startsAt: string;
  attendeeUserIds: string[];
}

export interface AnnouncementPublishedEvent {
  type: 'announcement.published';
  announcementId: string;
  title: string;
  audienceScope: 'ALL' | 'ROLE' | 'DEPARTMENT' | 'SECTION';
  audienceIds: string[];
}

export interface ModerationActionTakenEvent {
  type: 'moderation.action_taken';
  action:
    | 'REMOVE_CONTENT'
    | 'RESTORE_CONTENT'
    | 'WARN_USER'
    | 'SUSPEND_COMMUNITY'
    | 'LIFT_SUSPENSION';
  targetUserId: string;
  note: string | null;
}

export type DomainEvent =
  | AttendanceMarkedAbsentEvent
  | AssignmentPublishedEvent
  | AssignmentGradedEvent
  | AssignmentDueSoonEvent
  | ResultsPublishedEvent
  | InvoiceIssuedEvent
  | InvoiceOverdueEvent
  | CommunityCommentEvent
  | CommunityLikeEvent
  | GroupRequestEvent
  | MembershipDecidedEvent
  | EventCreatedEvent
  | EventReminderEvent
  | AnnouncementPublishedEvent
  | ModerationActionTakenEvent;

export type DomainEventType = DomainEvent['type'];
