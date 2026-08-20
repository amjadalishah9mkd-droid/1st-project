'use client';

import { useSession } from '@/components/providers/session-provider';

/**
 * Dashboard (M1 scope).
 * Role-specific dashboards with module aggregates arrive in M9 — this page
 * shows only real session data available today: identity, role profile and
 * live permission grants resolved by the API. No mocked metrics.
 */
export default function DashboardPage() {
  const { user } = useSession();
  if (!user) return null;

  const roleLabel = user.role.charAt(0) + user.role.slice(1).toLowerCase();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome, {user.firstName}
        </h1>
        <p className="mt-1 text-sm text-ink-secondary">
          {roleLabel} · {user.college.name}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-card border border-line bg-surface-raised p-5 shadow-card">
          <h2 className="text-sm font-semibold">Your account</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Email</dt>
              <dd className="text-right font-medium">{user.email}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Role</dt>
              <dd className="font-medium">{roleLabel}</dd>
            </div>
            {user.teacherProfile ? (
              <>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Department</dt>
                  <dd className="font-medium">
                    {user.teacherProfile.departmentName}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Designation</dt>
                  <dd className="font-medium">
                    {user.teacherProfile.designation}
                  </dd>
                </div>
              </>
            ) : null}
            {user.studentProfile ? (
              <>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Department</dt>
                  <dd className="font-medium">
                    {user.studentProfile.departmentName}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Roll no</dt>
                  <dd className="font-medium">{user.studentProfile.rollNo}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Batch</dt>
                  <dd className="font-medium">{user.studentProfile.batch}</dd>
                </div>
              </>
            ) : null}
          </dl>
        </section>

        <section className="rounded-card border border-line bg-surface-raised p-5 shadow-card">
          <h2 className="text-sm font-semibold">Your access</h2>
          <p className="mt-1 text-xs text-ink-muted">
            Permissions resolved server-side for the {roleLabel} role.
          </p>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {user.permissions.map((grant) => (
              <li
                key={grant.key}
                className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs text-ink-secondary"
              >
                {grant.key}
                <span className="ml-1 text-ink-faint">· {grant.scope}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <p className="text-xs text-ink-muted">
        Academic modules (students, courses, attendance, …) arrive with
        Milestones M2–M9 per the CampusOS blueprint.
      </p>
    </div>
  );
}
