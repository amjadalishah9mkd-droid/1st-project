import type { PermissionKey } from '@campusos/shared';
import { ROUTE_PERMISSIONS } from '@campusos/shared';

export interface NavItem {
  href: string;
  label: string;
  permission: PermissionKey | null;
}

/**
 * Sidebar navigation (Blueprint §8).
 * An item appears only when BOTH hold:
 *  1. the route is implemented in the current milestone (no dead links,
 *     no fake functionality for future modules), and
 *  2. the user's resolved permissions allow it (ROUTE_PERMISSIONS map).
 *
 * As milestones land, add their routes to IMPLEMENTED_ROUTES — the
 * permission wiring is already in place via the shared map.
 */
const IMPLEMENTED_ROUTES: Array<{ href: string; label: string }> = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/students', label: 'Students' },
  { href: '/teachers', label: 'Teachers' },
  { href: '/departments', label: 'Departments' },
  { href: '/courses', label: 'Courses' },
  { href: '/sections', label: 'Sections' },
  { href: '/timetable', label: 'Timetable' },
  { href: '/attendance', label: 'Attendance' },
  { href: '/assignments', label: 'Assignments' },
  { href: '/exams', label: 'Exams' },
  { href: '/results', label: 'Results' },
  { href: '/fees', label: 'Fees' },
  { href: '/community', label: 'Community' },
  { href: '/announcements', label: 'Announcements' },
  { href: '/moderation', label: 'Moderation' },
  { href: '/verification', label: 'Verification' },
  { href: '/settings', label: 'Settings' },
  { href: '/audit', label: 'Audit log' },
  // M9: settings + dashboards polish
];

export function navItemsFor(
  hasPermission: (key: PermissionKey) => boolean,
): NavItem[] {
  return IMPLEMENTED_ROUTES.flatMap(({ href, label }) => {
    const permission = ROUTE_PERMISSIONS[href];
    if (permission !== null && permission !== undefined && !hasPermission(permission)) {
      return [];
    }
    return [{ href, label, permission: permission ?? null }];
  });
}
