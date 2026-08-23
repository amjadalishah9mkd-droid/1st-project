'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { ResultsResponse, StudentItem } from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useOptions } from '@/lib/hooks/use-list';
import { useSession } from '@/components/providers/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';

/**
 * Results page (M5):
 *  - Students: own result card (published exams only).
 *  - Teachers/Admin: pick a student (list already scoped server-side —
 *    teachers only see students of their sections) and view their card.
 */
export default function ResultsPage() {
  const { user, hasPermission } = useSession();
  const isStudent = user?.studentProfile !== null;
  const canPickStudent = !isStudent && hasPermission('results.read');
  const students = useOptions<StudentItem>('/students', canPickStudent);
  const [studentId, setStudentId] = useState('');
  const [results, setResults] = useState<ResultsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isStudent);

  const load = useCallback((targetStudentId?: string) => {
    setLoading(true);
    setError(null);
    const query = targetStudentId ? `?studentId=${targetStudentId}` : '';
    apiFetch<ResultsResponse>(`/results${query}`)
      .then((response) => setResults(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (isStudent) load();
  }, [isStudent, load]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Results"
        description={
          isStudent
            ? 'Your published exam results with percentage and grade.'
            : 'Published result cards per student.'
        }
      />

      {canPickStudent ? (
        <div className="mb-5 max-w-sm">
          <Select
            label="Student"
            value={studentId}
            onChange={(event) => {
              setStudentId(event.target.value);
              if (event.target.value) load(event.target.value);
              else setResults(null);
            }}
            placeholder={students.length ? 'Select student' : 'No students available'}
            options={students.map((student) => ({
              value: student.id,
              label: `${student.rollNo} — ${student.firstName} ${student.lastName}`,
            }))}
          />
        </div>
      ) : null}

      {loading ? (
        <Skeleton rows={6} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load(studentId || undefined)} />
      ) : !results ? (
        canPickStudent ? (
          <div className="rounded-card border border-line bg-surface-raised shadow-card">
            <EmptyState
              title="Choose a student"
              message="Their published results appear here."
            />
          </div>
        ) : null
      ) : results.rows.length === 0 ? (
        <div className="rounded-card border border-line bg-surface-raised shadow-card">
          <EmptyState
            title="No published results yet"
            message="Results appear here once an exam is published."
          />
        </div>
      ) : (
        <ResultCard results={results} />
      )}
    </div>
  );
}

function ResultCard({ results }: { results: ResultsResponse }) {
  const { user } = useSession();
  const isStudent = user?.studentProfile !== null;
  // Group rows by exam for a per-exam card layout.
  const byExam = new Map<string, typeof results.rows>();
  for (const row of results.rows) {
    const rows = byExam.get(row.examId) ?? [];
    rows.push(row);
    byExam.set(row.examId, rows);
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-surface-raised p-5 shadow-card">
        <div>
          <h2 className="text-sm font-semibold">{results.studentName}</h2>
          <p className="text-xs text-ink-muted">
            Overall: {results.overall.obtained}/{results.overall.max}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-2xl font-semibold tracking-tight">
            {results.overall.percentage === null
              ? '—'
              : `${results.overall.percentage}%`}
          </span>
          {results.overall.bandLabel ? (
            <Badge tone="brand">{results.overall.bandLabel}</Badge>
          ) : null}
        </div>
      </section>

      {[...byExam.entries()].map(([examId, rows]) => (
        <section
          key={examId}
          className="rounded-card border border-line bg-surface-raised shadow-card"
        >
          <h3 className="flex items-center justify-between border-b border-line px-5 py-3 text-sm font-semibold">
            <span>
            {rows[0].examTitle}{' '}
            <span className="font-normal text-ink-muted">
              · {rows[0].examType.charAt(0) + rows[0].examType.slice(1).toLowerCase()}
            </span>
            </span>
            <Link
              href={`/results/report/${examId}${isStudent ? '' : `?studentId=${results.studentId}`}`}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              Report card
            </Link>
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {['Course', 'Marks', '%', 'Grade'].map((header) => (
                  <th
                    key={header}
                    className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.examId}-${row.courseCode}-${row.sectionName}`}
                  className="border-b border-line last:border-b-0"
                >
                  <td className="px-5 py-2.5">
                    <p className="font-medium">{row.courseCode}</p>
                    <p className="text-xs text-ink-muted">{row.courseTitle}</p>
                  </td>
                  <td className="px-5 py-2.5">
                    {row.marksObtained}/{row.maxMarks}
                  </td>
                  <td className="px-5 py-2.5">{row.percentage}%</td>
                  <td className="px-5 py-2.5">
                    {row.bandLabel ? <Badge tone="brand">{row.bandLabel}</Badge> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
