'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useSession } from '@/components/providers/session-provider';
import { ErrorState, Skeleton } from '@/components/data/data-table';
import { Button } from '@/components/ui/button';
import {
  CourseTable,
  TermSummaryRow,
  gpaOrNotConfigured,
  type TermRecord,
} from '../academic-record';

/**
 * M18-W3 — transcript: FINALIZED terms only, assembled by the W2 API
 * (SUPERSEDED/VOID never appear). All values — including CGPA — come
 * frozen from the backend; null CGPA means the institutional
 * grade-point scale is not configured, and is shown honestly.
 */

interface TranscriptResponse {
  studentId: string;
  studentName: string;
  rollNo: string;
  admissionNo: string;
  academicStatus: string;
  creditsAttempted: number;
  creditsEarned: number | null;
  cgpa: string | null;
  terms: Array<TermRecord & { termLabel: string }>;
}

export default function TranscriptPage() {
  const search = useSearchParams();
  const studentId = search.get('studentId') ?? undefined;
  const { user } = useSession();
  const [data, setData] = useState<TranscriptResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const qs = studentId ? `?studentId=${studentId}` : '';
    apiFetch<TranscriptResponse>(`/results/transcript${qs}`)
      .then((response) => setData(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      )
      .finally(() => setLoading(false));
  }, [studentId]);
  useEffect(load, [load]);

  if (loading) return <Skeleton rows={10} />;
  if (error || !data) return <ErrorState message={error ?? 'Not found'} onRetry={load} />;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="print-hide mb-6 flex items-center justify-between">
        <p className="text-sm text-ink-muted">
          Assembled from finalized academic records · Use Print / Save as PDF
          for an official copy.
        </p>
        <Button onClick={() => window.print()}>Print / Save as PDF</Button>
      </div>

      <div className="rounded-card border border-line bg-white p-8 text-ink shadow-card print:border-0 print:shadow-none">
        <header className="border-b-2 border-ink pb-4 text-center">
          <h1 className="text-2xl font-bold tracking-tight">
            {user?.college.name ?? 'CampusOS'}
          </h1>
          <p className="text-sm text-ink-muted">
            {user?.college.code} · Academic Transcript
          </p>
        </header>

        <section className="mt-6 grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
          <p>
            <span className="text-ink-muted">Student:</span>{' '}
            <span className="font-semibold">{data.studentName}</span>
          </p>
          <p>
            <span className="text-ink-muted">Roll no:</span> {data.rollNo}
          </p>
          <p>
            <span className="text-ink-muted">Admission no:</span>{' '}
            {data.admissionNo}
          </p>
          <p>
            <span className="text-ink-muted">Status:</span> {data.academicStatus}
          </p>
        </section>

        {data.terms.length === 0 ? (
          <p className="mt-10 text-center text-sm text-ink-muted">
            No finalized academic records yet. Terms appear here once the
            college finalizes their results.
          </p>
        ) : (
          <>
            {data.terms.map((term) => (
              <section key={term.id} className="mt-8 break-inside-avoid">
                <div className="flex items-baseline justify-between border-b border-ink pb-1">
                  <h2 className="text-base font-semibold">{term.termLabel}</h2>
                  <Link
                    href={`/results/record/${term.termId}${
                      studentId ? `?studentId=${studentId}` : ''
                    }`}
                    className="print-hide text-xs font-medium text-brand-700 hover:underline"
                  >
                    Open report card
                  </Link>
                </div>
                <CourseTable courses={term.courses} />
                <TermSummaryRow record={term} />
              </section>
            ))}

            <section className="mt-10 border-t-2 border-ink pt-4">
              <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-muted">
                    Credits attempted
                  </dt>
                  <dd className="text-lg font-semibold">{data.creditsAttempted}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-muted">
                    Credits earned
                  </dt>
                  <dd className="text-lg font-semibold">
                    {data.creditsEarned ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-muted">
                    CGPA
                  </dt>
                  <dd className="text-lg font-semibold">
                    {gpaOrNotConfigured(data.cgpa)}
                  </dd>
                </div>
              </dl>
              {data.cgpa === null ? (
                <p className="mt-2 text-xs text-ink-muted">
                  CGPA is unavailable because the college&rsquo;s grade-point
                  scale is not configured.
                </p>
              ) : null}
            </section>

            <footer className="mt-16 grid grid-cols-2 gap-8 text-center text-xs text-ink-muted">
              <div className="border-t border-ink pt-2">Controller of Examinations</div>
              <div className="border-t border-ink pt-2">Principal / Registrar</div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
