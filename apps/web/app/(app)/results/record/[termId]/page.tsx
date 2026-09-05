'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useSession } from '@/components/providers/session-provider';
import { ErrorState, Skeleton } from '@/components/data/data-table';
import { Button } from '@/components/ui/button';
import {
  CourseTable,
  TermSummaryRow,
  gpaOrNotConfigured,
  type TermRecord,
} from '../../academic-record';

/**
 * M18-W3 — finalized TERM report card. Renders the immutable W2 snapshot
 * (GET /results/report/term/:termId) — never live marks. Read-only for
 * every persona; the API enforces OWN/CHILD/ALL scopes and tenancy.
 */

interface ReportResponse extends TermRecord {
  termLabel: string;
  studentName: string;
  rollNo: string;
}

export default function TermReportCardPage() {
  const params = useParams<{ termId: string }>();
  const search = useSearchParams();
  const studentId = search.get('studentId') ?? undefined;
  const { user } = useSession();
  const [data, setData] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFinalized, setNotFinalized] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setNotFinalized(false);
    const qs = studentId ? `?studentId=${studentId}` : '';
    apiFetch<ReportResponse>(`/results/report/term/${params.termId}${qs}`)
      .then((response) => setData(response.data))
      .catch((err) => {
        if (err instanceof ApiError && err.code === 'NOT_FINALIZED') {
          setNotFinalized(true);
        } else {
          setError(err instanceof ApiError ? err.message : 'Failed to load');
        }
      })
      .finally(() => setLoading(false));
  }, [params.termId, studentId]);
  useEffect(load, [load]);

  if (loading) return <Skeleton rows={8} />;
  if (notFinalized) {
    return (
      <div className="mx-auto max-w-3xl rounded-card border border-line bg-surface-raised p-10 text-center">
        <h1 className="text-lg font-semibold">Result not finalized</h1>
        <p className="mt-2 text-sm text-ink-muted">
          This term&rsquo;s academic result has not been finalized yet. Report
          cards become available once the college finalizes the term&rsquo;s
          results.
        </p>
      </div>
    );
  }
  if (error || !data) return <ErrorState message={error ?? 'Not found'} onRetry={load} />;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="print-hide mb-6 flex items-center justify-between">
        <p className="text-sm text-ink-muted">
          Finalized record v{data.version} · Use Print / Save as PDF for an
          official copy.
        </p>
        <Button onClick={() => window.print()}>Print / Save as PDF</Button>
      </div>

      <div className="rounded-card border border-line bg-white p-8 text-ink shadow-card print:border-0 print:shadow-none">
        <header className="border-b-2 border-ink pb-4 text-center">
          <h1 className="text-2xl font-bold tracking-tight">
            {user?.college.name ?? 'CampusOS'}
          </h1>
          <p className="text-sm text-ink-muted">
            {user?.college.code} · Term Report Card
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
            <span className="text-ink-muted">Term:</span>{' '}
            <span className="font-semibold">{data.termLabel}</span>
          </p>
          <p>
            <span className="text-ink-muted">Finalized:</span>{' '}
            {new Date(data.finalizedAt).toLocaleDateString()}
          </p>
        </section>

        <CourseTable courses={data.courses} />
        <TermSummaryRow record={data} />

        <section className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-3">
          <p>
            <span className="text-ink-muted">Attendance:</span>{' '}
            {data.attendancePercent !== null ? `${data.attendancePercent}%` : '—'}
          </p>
          <p>
            <span className="text-ink-muted">Grade point:</span>{' '}
            {gpaOrNotConfigured(data.gradePoint)}
          </p>
        </section>

        <footer className="mt-16 grid grid-cols-2 gap-8 text-center text-xs text-ink-muted">
          <div className="border-t border-ink pt-2">Class Teacher</div>
          <div className="border-t border-ink pt-2">Principal / Registrar</div>
        </footer>
      </div>
    </div>
  );
}
