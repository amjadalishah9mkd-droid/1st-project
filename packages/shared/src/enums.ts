/**
 * CampusOS shared enums.
 * Mirrors the Prisma enums exactly (Blueprint §1–§3). The Prisma schema is the
 * database source of truth; this module is the application-layer mirror so the
 * frontend never imports Prisma client types.
 */

export const RoleKey = {
  ADMIN: 'ADMIN',
  TEACHER: 'TEACHER',
  STUDENT: 'STUDENT',
} as const;
export type RoleKey = (typeof RoleKey)[keyof typeof RoleKey];

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const PermissionScope = {
  OWN: 'OWN',
  ASSIGNED: 'ASSIGNED',
  DEPARTMENT: 'DEPARTMENT',
  ALL: 'ALL',
} as const;
export type PermissionScope =
  (typeof PermissionScope)[keyof typeof PermissionScope];

export const StudentStatus = {
  ENROLLED: 'ENROLLED',
  GRADUATED: 'GRADUATED',
  WITHDRAWN: 'WITHDRAWN',
  SUSPENDED: 'SUSPENDED',
} as const;
export type StudentStatus = (typeof StudentStatus)[keyof typeof StudentStatus];

export const CourseStatus = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;
export type CourseStatus = (typeof CourseStatus)[keyof typeof CourseStatus];

export const EnrollmentStatus = {
  ACTIVE: 'ACTIVE',
  DROPPED: 'DROPPED',
  COMPLETED: 'COMPLETED',
} as const;
export type EnrollmentStatus =
  (typeof EnrollmentStatus)[keyof typeof EnrollmentStatus];

export const SessionStatus = {
  SCHEDULED: 'SCHEDULED',
  HELD: 'HELD',
  CANCELLED: 'CANCELLED',
} as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

export const AttendanceStatus = {
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
  LATE: 'LATE',
  EXCUSED: 'EXCUSED',
} as const;
export type AttendanceStatus =
  (typeof AttendanceStatus)[keyof typeof AttendanceStatus];

export const ExamType = {
  QUIZ: 'QUIZ',
  MIDTERM: 'MIDTERM',
  FINAL: 'FINAL',
  PRACTICAL: 'PRACTICAL',
} as const;
export type ExamType = (typeof ExamType)[keyof typeof ExamType];

export const ExamStatus = {
  DRAFT: 'DRAFT',
  SCHEDULED: 'SCHEDULED',
  COMPLETED: 'COMPLETED',
  PUBLISHED: 'PUBLISHED',
} as const;
export type ExamStatus = (typeof ExamStatus)[keyof typeof ExamStatus];

export const InvoiceStatus = {
  PENDING: 'PENDING',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  CANCELLED: 'CANCELLED',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const PaymentMethod = {
  CASH: 'CASH',
  BANK_TRANSFER: 'BANK_TRANSFER',
  CHEQUE: 'CHEQUE',
  OTHER: 'OTHER',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PostType = {
  GENERAL: 'GENERAL',
  RESOURCE: 'RESOURCE',
  ACHIEVEMENT: 'ACHIEVEMENT',
  EVENT_SHARE: 'EVENT_SHARE',
} as const;
export type PostType = (typeof PostType)[keyof typeof PostType];

export const ContentStatus = {
  ACTIVE: 'ACTIVE',
  REMOVED_BY_AUTHOR: 'REMOVED_BY_AUTHOR',
  REMOVED_BY_MODERATOR: 'REMOVED_BY_MODERATOR',
} as const;
export type ContentStatus = (typeof ContentStatus)[keyof typeof ContentStatus];

export const GroupPrivacy = {
  OPEN: 'OPEN',
  REQUEST: 'REQUEST',
} as const;
export type GroupPrivacy = (typeof GroupPrivacy)[keyof typeof GroupPrivacy];

export const GroupRole = {
  MEMBER: 'MEMBER',
  MODERATOR: 'MODERATOR',
} as const;
export type GroupRole = (typeof GroupRole)[keyof typeof GroupRole];

export const MembershipStatus = {
  ACTIVE: 'ACTIVE',
  PENDING: 'PENDING',
} as const;
export type MembershipStatus =
  (typeof MembershipStatus)[keyof typeof MembershipStatus];

export const SocietyCategory = {
  TECHNICAL: 'TECHNICAL',
  CULTURAL: 'CULTURAL',
  SPORTS: 'SPORTS',
  LITERARY: 'LITERARY',
  SOCIAL: 'SOCIAL',
  OTHER: 'OTHER',
} as const;
export type SocietyCategory =
  (typeof SocietyCategory)[keyof typeof SocietyCategory];

export const SocietyRole = {
  MEMBER: 'MEMBER',
  OFFICER: 'OFFICER',
  PRESIDENT: 'PRESIDENT',
} as const;
export type SocietyRole = (typeof SocietyRole)[keyof typeof SocietyRole];

export const SocietyStatus = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;
export type SocietyStatus = (typeof SocietyStatus)[keyof typeof SocietyStatus];

export const GroupStatus = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;
export type GroupStatus = (typeof GroupStatus)[keyof typeof GroupStatus];

export const EventStatus = {
  ACTIVE: 'ACTIVE',
  CANCELLED: 'CANCELLED',
  REMOVED: 'REMOVED',
} as const;
export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];

export const RsvpStatus = {
  GOING: 'GOING',
  INTERESTED: 'INTERESTED',
  DECLINED: 'DECLINED',
} as const;
export type RsvpStatus = (typeof RsvpStatus)[keyof typeof RsvpStatus];

export const ReportTargetType = {
  POST: 'POST',
  COMMENT: 'COMMENT',
  USER: 'USER',
  EVENT: 'EVENT',
  RESOURCE: 'RESOURCE',
} as const;
export type ReportTargetType =
  (typeof ReportTargetType)[keyof typeof ReportTargetType];

export const ReportReason = {
  SPAM: 'SPAM',
  HARASSMENT: 'HARASSMENT',
  INAPPROPRIATE: 'INAPPROPRIATE',
  MISINFORMATION: 'MISINFORMATION',
  OTHER: 'OTHER',
} as const;
export type ReportReason = (typeof ReportReason)[keyof typeof ReportReason];

export const ReportStatus = {
  OPEN: 'OPEN',
  REVIEWING: 'REVIEWING',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
} as const;
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

export const ModerationActionType = {
  REMOVE_CONTENT: 'REMOVE_CONTENT',
  RESTORE_CONTENT: 'RESTORE_CONTENT',
  WARN_USER: 'WARN_USER',
  SUSPEND_COMMUNITY: 'SUSPEND_COMMUNITY',
  LIFT_SUSPENSION: 'LIFT_SUSPENSION',
} as const;
export type ModerationActionType =
  (typeof ModerationActionType)[keyof typeof ModerationActionType];

export const AnnouncementScope = {
  ALL: 'ALL',
  ROLE: 'ROLE',
  DEPARTMENT: 'DEPARTMENT',
  SECTION: 'SECTION',
} as const;
export type AnnouncementScope =
  (typeof AnnouncementScope)[keyof typeof AnnouncementScope];
