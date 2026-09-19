'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { GuardianChildItem } from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';

/**
 * M13-W4 — guardian child list (/children).
 * Server truth only: GET /guardian/children returns the caller's ACTIVE
 * links exclusively (H6) — there is no way to enter arbitrary student ids
 * here, and revoked links never appear.
 */
export default function ChildrenPage() {
  const [children, setChildren] = useState<GuardianChildItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setChildren(null);
    setError(null);
    apiFetch<GuardianChildItem[]>('/guardian/children')
      .then((response) => setChildren(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      );
  };
  useEffect(load, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!children) return <Skeleton rows={6} />;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="My children"
        description="Students linked to your guardian account by the college."
      />

      {children.length === 0 ? (
        <div className="rounded-card border border-line bg-surface-raised shadow-card">
          <EmptyState
            title="No linked children"
            message="When the college links a student to your account, they appear here. Contact the college office if you believe this is a mistake."
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {children.map((child) => (
            <li key={child.studentProfileId}>
              <Link
                href={`/children/${child.studentProfileId}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface-raised p-5 shadow-card transition-colors hover:border-brand-300"
              >
                <div>
                  <p className="text-sm font-semibold">
                    {child.firstName} {child.lastName}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {child.departmentName} · Batch {child.batch}
                  </p>
                  <p className="font-mono text-xs text-ink-muted">
                    Roll {child.rollNo} · Adm {child.admissionNo}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone="brand">{child.relationship}</Badge>
                  <Badge tone="success">Active</Badge>
                  <span className="text-sm font-medium text-brand-700">
                    View details →
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
