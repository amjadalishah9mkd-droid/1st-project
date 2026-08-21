'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { PageMeta } from '@campusos/shared';
import { apiFetch } from '@/lib/api/client';
import { useSession } from '@/components/providers/session-provider';

/**
 * Dashboard (M2 state).
 * Shows real academic counts from the live list APIs (each already scoped to
 * the caller by the server). Full role-specific analytics arrive in M9.
 */

function useCount(path: string, enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiFetch<unknown[]>(`${path}?page=1&limit=1`)
      .then((response) => {
        if (!cancelled) setCount((response.meta as PageMeta)?.total ?? 0);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path, enabled]);
  return count;
}

export default function DashboardPage() {
  const { user, hasPermission } = useSession();
  const canReadUsers = hasPermission('users.manage');
  const canReadAcademics = hasPermission('academics.read');
  const students = useCount('/students', canReadUsers);
  const teachers = useCount('/teachers', canReadUsers);
  const courses = useCount('/courses', canReadAcademics);
  const sections = useCount('/sections', canReadAcademics);
  if (!user) return null;

  const roleLabel = user.role.charAt(0) + user.role.slice(1).toLowerCase();
  const isStudent = user.studentProfile !== null;

  const stats: Array<{ label: string; value: number | null; href: string; show: boolean }> = [
    { label: 'Students', value: students, href: '/students', show: canReadUsers },
    { label: 'Teachers', value: teachers, href: '/teachers', show: canReadUsers },
    {
      label: isStudent ? 'My courses' : 'Courses',
      value: courses,
      href: '/courses',
      show: canReadAcademics,
    },
    {
      label: isStudent ? 'My sections' : 'Sections',
      value: sections,
      href: '/sections',
      show: canReadAcademics,
    },
  ];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome, {user.firstName}
        </h1>
        <p className="mt-1 text-sm text-ink-secondary">
          {roleLabel} · {user.college.name}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats
          .filter((stat) => stat.show)
          .map((stat) => (
            <Link
              key={stat.label}
              href={stat.href}
              className="rounded-card border border-line bg-surface-raised p-4 shadow-card transition-colors hover:border-brand-300"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                {stat.label}
              </p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">
                {stat.value ?? '—'}
              </p>
            </Link>
          ))}
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
                  <dd className="font-medium">{user.teacherProfile.departmentName}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Designation</dt>
                  <dd className="font-medium">{user.teacherProfile.designation}</dd>
                </div>
              </>
            ) : null}
            {user.studentProfile ? (
              <>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Department</dt>
                  <dd className="font-medium">{user.studentProfile.departmentName}</dd>
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
    </div>
  );
}
