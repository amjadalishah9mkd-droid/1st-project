import { PermissionScope, RoleKey } from './enums';

/**
 * Permission catalog (Blueprint §5).
 * These keys are seeded into the `Permission` table and referenced by
 * `RolePermission` rows. All authorization flows through
 * PolicyService.can(user, key, context) — never hardcoded role checks.
 */
export const PERMISSIONS = {
  USERS_MANAGE: 'users.manage',
  USERS_READ: 'users.read',
  ACADEMICS_MANAGE: 'academics.manage',
  ACADEMICS_READ: 'academics.read',
  ENROLLMENT_MANAGE: 'enrollment.manage',
  TIMETABLE_MANAGE: 'timetable.manage',
  TIMETABLE_READ: 'timetable.read',
  ATTENDANCE_RECORD: 'attendance.record',
  ATTENDANCE_READ: 'attendance.read',
  ASSIGNMENTS_MANAGE: 'assignments.manage',
  ASSIGNMENTS_READ: 'assignments.read',
  ASSIGNMENTS_SUBMIT: 'assignments.submit',
  ASSIGNMENTS_GRADE: 'assignments.grade',
  EXAMS_MANAGE: 'exams.manage',
  MARKS_ENTER: 'marks.enter',
  RESULTS_PUBLISH: 'results.publish',
  RESULTS_READ: 'results.read',
  FEES_MANAGE: 'fees.manage',
  FEES_READ: 'fees.read',
  PAYMENTS_INITIATE: 'payments.initiate',
  FINANCE_REFUND: 'finance.refund',
  COMMUNITY_PARTICIPATE: 'community.participate',
  COMMUNITY_GROUPS_CREATE: 'community.groups.create',
  COMMUNITY_SOCIETIES_MANAGE: 'community.societies.manage',
  COMMUNITY_EVENTS_CREATE: 'community.events.create',
  COMMUNITY_REPORT: 'community.report',
  MODERATION_ACT: 'moderation.act',
  ANNOUNCEMENTS_CREATE: 'announcements.create',
  SETTINGS_MANAGE: 'settings.manage',
  VERIFICATION_MANAGE: 'verification.manage',
  VERIFICATION_SUBMIT: 'verification.submit',
  AUDIT_READ: 'audit.read',
  GUARDIAN_CHILDREN: 'guardian.children',
  DASHBOARD_GUARDIAN: 'dashboard.guardian',
  DASHBOARD_ADMIN: 'dashboard.admin',
  DASHBOARD_TEACHER: 'dashboard.teacher',
  DASHBOARD_STUDENT: 'dashboard.student',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  'users.manage': 'Create, update, archive and suspend user accounts',
  'users.read': 'View user directories and profiles',
  'academics.manage':
    'Manage departments, courses, academic years, terms and sections',
  'academics.read': 'View academic structure',
  'enrollment.manage': 'Enroll/withdraw students and assign teachers to sections',
  'timetable.manage': 'Create and edit timetable slots',
  'timetable.read': 'View timetables',
  'attendance.record': 'Take and edit attendance for class sessions',
  'attendance.read': 'View attendance records and summaries',
  'assignments.manage': 'Create, edit, publish and delete assignments',
  'assignments.read': 'View assignments',
  'assignments.submit': 'Submit work for assignments',
  'assignments.grade': 'Grade assignment submissions',
  'exams.manage': 'Create and schedule exams and papers',
  'marks.enter': 'Enter and edit draft marks',
  'results.publish': 'Publish exam results (locks marks)',
  'results.read': 'View exam results',
  'fees.manage': 'Manage fee structures, invoices and payments',
  'fees.read': 'View fee invoices and payment history',
  'finance.refund':
    'Initiate, execute and cancel refunds of settled payments',
  'payments.initiate': 'Initiate an online payment for an own invoice',
  'community.participate': 'Post, comment, like and RSVP in the community',
  'community.groups.create': 'Create community groups',
  'community.societies.manage': 'Charter, edit and archive societies',
  'community.events.create': 'Create campus-wide events',
  'community.report': 'Report community content',
  'moderation.act': 'Act on reports: remove, warn, suspend, restore',
  'announcements.create': 'Publish announcements',
  'settings.manage': 'Manage college settings, terms and grade bands',
  'verification.manage':
    'Review student identity claims, view verification evidence and decide approvals',
  'verification.submit':
    'Submit and manage own student identity verification claim',
  'audit.read': 'View the college security audit log',
  'guardian.children': 'List and view own linked children',
  'dashboard.guardian': 'View the guardian dashboard',
  'dashboard.admin': 'View the admin dashboard',
  'dashboard.teacher': 'View the teacher dashboard',
  'dashboard.student': 'View the student dashboard',
};

export interface RolePermissionGrant {
  role: RoleKey;
  permission: PermissionKey;
  scope: PermissionScope;
}

/**
 * Role → permission → scope matrix (Blueprint §5). Seeded into RolePermission.
 * Absence of a row means denied.
 */
export const ROLE_PERMISSION_MATRIX: RolePermissionGrant[] = [
  // ── ADMIN ──────────────────────────────────────────────
  { role: 'ADMIN', permission: 'users.manage', scope: 'ALL' },
  { role: 'ADMIN', permission: 'users.read', scope: 'ALL' },
  { role: 'ADMIN', permission: 'academics.manage', scope: 'ALL' },
  { role: 'ADMIN', permission: 'academics.read', scope: 'ALL' },
  { role: 'ADMIN', permission: 'enrollment.manage', scope: 'ALL' },
  { role: 'ADMIN', permission: 'timetable.manage', scope: 'ALL' },
  { role: 'ADMIN', permission: 'timetable.read', scope: 'ALL' },
  { role: 'ADMIN', permission: 'attendance.record', scope: 'ALL' },
  { role: 'ADMIN', permission: 'attendance.read', scope: 'ALL' },
  { role: 'ADMIN', permission: 'assignments.manage', scope: 'ALL' },
  { role: 'ADMIN', permission: 'assignments.read', scope: 'ALL' },
  { role: 'ADMIN', permission: 'assignments.grade', scope: 'ALL' },
  { role: 'ADMIN', permission: 'exams.manage', scope: 'ALL' },
  { role: 'ADMIN', permission: 'marks.enter', scope: 'ALL' },
  { role: 'ADMIN', permission: 'results.publish', scope: 'ALL' },
  { role: 'ADMIN', permission: 'results.read', scope: 'ALL' },
  { role: 'ADMIN', permission: 'fees.manage', scope: 'ALL' },
  { role: 'ADMIN', permission: 'fees.read', scope: 'ALL' },
  { role: 'ADMIN', permission: 'community.participate', scope: 'ALL' },
  { role: 'ADMIN', permission: 'community.groups.create', scope: 'ALL' },
  { role: 'ADMIN', permission: 'community.societies.manage', scope: 'ALL' },
  { role: 'ADMIN', permission: 'community.events.create', scope: 'ALL' },
  { role: 'ADMIN', permission: 'community.report', scope: 'ALL' },
  { role: 'ADMIN', permission: 'moderation.act', scope: 'ALL' },
  { role: 'ADMIN', permission: 'announcements.create', scope: 'ALL' },
  { role: 'ADMIN', permission: 'settings.manage', scope: 'ALL' },
  { role: 'ADMIN', permission: 'verification.manage', scope: 'ALL' },
  { role: 'ADMIN', permission: 'finance.refund', scope: 'ALL' },
  { role: 'ADMIN', permission: 'audit.read', scope: 'ALL' },
  { role: 'ADMIN', permission: 'dashboard.admin', scope: 'ALL' },

  // ── TEACHER ────────────────────────────────────────────
  { role: 'TEACHER', permission: 'users.read', scope: 'ASSIGNED' },
  { role: 'TEACHER', permission: 'academics.read', scope: 'ALL' },
  { role: 'TEACHER', permission: 'timetable.read', scope: 'OWN' },
  { role: 'TEACHER', permission: 'attendance.record', scope: 'ASSIGNED' },
  { role: 'TEACHER', permission: 'attendance.read', scope: 'ASSIGNED' },
  { role: 'TEACHER', permission: 'assignments.manage', scope: 'ASSIGNED' },
  { role: 'TEACHER', permission: 'assignments.read', scope: 'ASSIGNED' },
  { role: 'TEACHER', permission: 'assignments.grade', scope: 'ASSIGNED' },
  { role: 'TEACHER', permission: 'marks.enter', scope: 'ASSIGNED' },
  { role: 'TEACHER', permission: 'results.read', scope: 'ASSIGNED' },
  { role: 'TEACHER', permission: 'community.participate', scope: 'ALL' },
  { role: 'TEACHER', permission: 'community.groups.create', scope: 'ALL' },
  { role: 'TEACHER', permission: 'community.events.create', scope: 'ALL' },
  { role: 'TEACHER', permission: 'community.report', scope: 'ALL' },
  { role: 'TEACHER', permission: 'announcements.create', scope: 'ASSIGNED' },
  { role: 'TEACHER', permission: 'dashboard.teacher', scope: 'OWN' },

  // ── STUDENT ────────────────────────────────────────────
  { role: 'STUDENT', permission: 'users.read', scope: 'OWN' },
  { role: 'STUDENT', permission: 'academics.read', scope: 'OWN' },
  { role: 'STUDENT', permission: 'timetable.read', scope: 'OWN' },
  { role: 'STUDENT', permission: 'attendance.read', scope: 'OWN' },
  { role: 'STUDENT', permission: 'assignments.read', scope: 'OWN' },
  { role: 'STUDENT', permission: 'assignments.submit', scope: 'OWN' },
  { role: 'STUDENT', permission: 'results.read', scope: 'OWN' },
  { role: 'STUDENT', permission: 'fees.read', scope: 'OWN' },
  // M14-W1 (decision #3/#4): students may pay their OWN invoices online;
  // guardians deliberately receive no payments.initiate grant in V1.
  { role: 'STUDENT', permission: 'payments.initiate', scope: 'OWN' },
  { role: 'STUDENT', permission: 'community.participate', scope: 'OWN' },
  { role: 'STUDENT', permission: 'community.groups.create', scope: 'ALL' },
  { role: 'STUDENT', permission: 'community.report', scope: 'ALL' },
  { role: 'STUDENT', permission: 'dashboard.student', scope: 'OWN' },
  { role: 'STUDENT', permission: 'verification.submit', scope: 'OWN' },

  // ── ACCOUNTANT (M16, D-1/D-6): finance-only staff role ───────────────
  { role: 'ACCOUNTANT', permission: 'fees.read', scope: 'ALL' },
  { role: 'ACCOUNTANT', permission: 'fees.manage', scope: 'ALL' },
  { role: 'ACCOUNTANT', permission: 'users.read', scope: 'ALL' },
  { role: 'ACCOUNTANT', permission: 'audit.read', scope: 'ALL' },
  { role: 'ACCOUNTANT', permission: 'finance.refund', scope: 'ALL' },

  // ── GUARDIAN (M13, decisions G1–G7): read-only, CHILD-scoped ─────────
  { role: 'GUARDIAN', permission: 'guardian.children', scope: 'OWN' },
  { role: 'GUARDIAN', permission: 'dashboard.guardian', scope: 'OWN' },
  { role: 'GUARDIAN', permission: 'results.read', scope: 'CHILD' },
  { role: 'GUARDIAN', permission: 'attendance.read', scope: 'CHILD' },
  { role: 'GUARDIAN', permission: 'fees.read', scope: 'CHILD' },
  { role: 'GUARDIAN', permission: 'timetable.read', scope: 'CHILD' },
  { role: 'GUARDIAN', permission: 'assignments.read', scope: 'CHILD' },
];

/**
 * Route → required permission map (Blueprint §8).
 * Single source of truth for the Next.js middleware (redirects) and the
 * sidebar builder (visibility). Longest-prefix match wins.
 */
export const ROUTE_PERMISSIONS: Record<string, PermissionKey | null> = {
  '/dashboard': null, // any authenticated user; content is role-dispatched
  '/students': 'users.manage', // directory management pages are admin surfaces;
  '/teachers': 'users.manage', // teachers reach rosters via the section hub
  '/departments': 'academics.manage',
  '/calendar': 'academics.manage', // M15-W1: academic years & terms admin
  '/courses': 'academics.read',
  '/sections': 'academics.read',
  '/timetable': 'timetable.read',
  '/attendance': 'attendance.read',
  '/assignments': 'assignments.read',
  '/exams': 'marks.enter',
  '/results': 'results.read',
  '/fees': 'fees.read',
  '/community': 'community.participate',
  '/moderation': 'moderation.act',
  '/verification': 'verification.manage',
  '/audit': 'audit.read',
  '/children': 'guardian.children',
  '/announcements': null,
  '/notifications': null,
  '/settings': 'settings.manage',
};

/**
 * Longest-prefix route → permission resolution.
 * Returns undefined when the path is not governed by the map.
 */
export function matchRoutePermission(
  pathname: string,
): PermissionKey | null | undefined {
  let match: string | undefined;
  for (const prefix of Object.keys(ROUTE_PERMISSIONS)) {
    if (
      (pathname === prefix || pathname.startsWith(`${prefix}/`)) &&
      (!match || prefix.length > match.length)
    ) {
      match = prefix;
    }
  }
  return match === undefined ? undefined : ROUTE_PERMISSIONS[match];
}

/**
 * Role-level grant lookup against the seeded matrix.
 * This is the same single source that seeds RolePermission — the frontend
 * middleware uses it as a routing hint only; the API resolves authorization
 * from the database on every request.
 */
export function roleHasPermission(
  role: RoleKey,
  permission: PermissionKey,
): boolean {
  return ROLE_PERMISSION_MATRIX.some(
    (grant) => grant.role === role && grant.permission === permission,
  );
}
