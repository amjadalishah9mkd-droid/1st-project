'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import type { ResultsResponse } from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useSession } from '@/components/providers/session-provider';
import { ErrorState, Skeleton } from '@/components/data/data-table';
import { Button } from '@/components/ui/button';

/**
 * M12-W3 — per-exam report card (decisions A1/A2/A4).
 * Print-CSS output: the browser's Print / Save-as-PDF is the export path —
 * no PDF dependency. Staff may pass ?studentId= (the API enforces scope:
 * OWN callers are always pinned to their own record server-side).
 */
export default function ReportCardPage() {
  const params = useParams<{ examId: string }>();
  const search = useSearchParams();
  const studentId = search.get('studentId') ?? undefined;
  const { user } = useSession();
  const [data, setData] = useState<ResultsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    const qs = new URLSearchParams();
    if (studentId) qs.set('studentId', studentId);
    apiFetch<ResultsResponse>(`/results${qs.size ? `?${qs}` : ''}`)
      .then((response) => setData(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load results'),
      );
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [studentId]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Skeleton rows={8} />;

  const rows = data.rows.filter((row) => row.examId === params.examId);
  const examTitle = rows[0]?.examTitle ?? 'Exam';
  const examType = rows[0]?.examType ?? '';
  const obtained = rows.reduce((sum, r) => sum + Number(r.marksObtained), 0);
  const max = rows.reduce((sum, r) => sum + Number(r.maxMarks), 0);
  const percentage = max > 0 ? (obtained / max) * 100 : null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="print-hide mb-6 flex items-center justify-between">
        <p className="text-sm text-ink-muted">
          Use Print / Save as PDF for an official copy.
        </p>
        <Button onClick={() => window.print()}>Print / Save as PDF</Button>
      </div>

      <div className="rounded-card border border-line bg-white p-8 text-ink shadow-card print:border-0 print:shadow-none">
        <header className="border-b-2 border-ink pb-4 text-center">
          <h1 className="text-2xl font-bold tracking-tight">
            {user?.college.name ?? 'CampusOS'}
          </h1>
          <p className="text-sm text-ink-muted">
            {user?.college.code} · Report Card
          </p>
        </header>

        <section className="mt-6 grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
          <p>
            <span className="text-ink-muted">Student:</span>{' '}
            <span className="font-semibold">{data.studentName}</span>
          </p>
          <p>
            <span className="text-ink-muted">Term:</span>{' '}
            {data.termLabel ?? '—'}
          </p>
          <p>
            <span className="text-ink-muted">Examination:</span>{' '}
            <span className="font-semibold">{examTitle}</span>
          </p>
          <p>
            <span className="text-ink-muted">Type:</span> {examType}
          </p>
        </section>

        {rows.length === 0 ? (
          <p className="mt-8 text-center text-sm text-ink-muted">
            No published results for this examination.
          </p>
        ) : (
          <>
            <table className="mt-6 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-ink text-left">
                  <th className="py-2 pr-3">Course</th>
                  <th className="py-2 pr-3">Section</th>
                  <th className="py-2 pr-3 text-right">Marks</th>
                  <th className="py-2 pr-3 text-right">Max</th>
                  <th className="py-2 pr-3 text-right">%</th>
                  <th className="py-2 text-right">Grade</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.examId}-${row.courseCode}-${row.sectionName}`} className="border-b border-line">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{row.courseCode}</span>{' '}
                      <span className="text-ink-muted">{row.courseTitle}</span>
                    </td>
                    <td className="py-2 pr-3">{row.sectionName}</td>
                    <td className="py-2 pr-3 text-right">{row.marksObtained}</td>
                    <td className="py-2 pr-3 text-right">{row.maxMarks}</td>
                    <td className="py-2 pr-3 text-right">
                      {row.percentage.toFixed(1)}
                    </td>
                    <td className="py-2 text-right font-medium">
                      {row.bandLabel ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink font-semibold">
                  <td className="py-2 pr-3" colSpan={2}>
                    Total
                  </td>
                  <td className="py-2 pr-3 text-right">{obtained}</td>
                  <td className="py-2 pr-3 text-right">{max}</td>
                  <td className="py-2 pr-3 text-right">
                    {percentage === null ? '—' : percentage.toFixed(1)}
                  </td>
                  <td className="py-2 text-right" />
                </tr>
              </tfoot>
            </table>

            <footer className="mt-16 grid grid-cols-2 gap-8 text-center text-xs text-ink-muted">
              <div className="border-t border-ink pt-2">Class Teacher</div>
              <div className="border-t border-ink pt-2">Principal / Registrar</div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
