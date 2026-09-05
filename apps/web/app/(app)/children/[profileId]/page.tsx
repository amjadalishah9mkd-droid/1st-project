'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import type {
  AssignmentItem,
  AttendanceSummaryResponse,
  GuardianChildItem,
  InvoiceItem,
  ResultsResponse,
  StudentSectionAttendance,
  TimetableSlotItem,
} from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { formatAmount, formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { invoiceTone } from '../../fees/fee-utils';

/**
 * M13-W4 — guardian child detail (/children/[profileId]).
 *
 * Every tab consumes a W3 CHILD-scoped API; the ACTIVE GuardianLink is
 * verified server-side on every request. The child's identity is resolved
 * from GET /guardian/children (the caller's own links) — an arbitrary
 * profileId in the URL simply isn't in that list, and every data call for
 * it would 403 anyway. Read-only by design: no marking, submitting,
 * paying or editing surfaces exist here.
 */

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'results', label: 'Results' },
  { id: 'fees', label: 'Fees' },
  { id: 'timetable', label: 'Timetable' },
  { id: 'assignments', label: 'Assignments' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function ChildDetailPage() {
  const params = useParams<{ profileId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const profileId = params.profileId;
  const requestedTab = search.get('tab');
  const tab: TabId = TABS.some((t) => t.id === requestedTab)
    ? (requestedTab as TabId)
    : 'overview';

  const [children, setChildren] = useState<GuardianChildItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setChildren(null);
    setError(null);
    apiFetch<GuardianChildItem[]>('/guardian/children')
      .then((response) => setChildren(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      );
  }, []);
  useEffect(load, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!children) return <Skeleton rows={8} />;

  const child = children.find((c) => c.studentProfileId === profileId);
  if (!child) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="rounded-card border border-line bg-surface-raised shadow-card">
          <EmptyState
            title="Child not available"
            message="This student is not linked to your account, or the link has been revoked."
          />
        </div>
        <div className="mt-4 text-center">
          <Link
            href="/children"
            className="text-sm font-medium text-brand-700 hover:underline"
          >
            ← Back to my children
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`${child.firstName} ${child.lastName}`}
        description={`${child.departmentName} · Batch ${child.batch} · Roll ${child.rollNo}`}
        actions={<Badge tone="brand">{child.relationship}</Badge>}
      />

      <nav
        className="mb-6 flex gap-1 overflow-x-auto rounded-lg border border-line bg-surface-raised p-1"
        aria-label="Child sections"
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() =>
              router.replace(`/children/${profileId}?tab=${item.id}`, {
                scroll: false,
              })
            }
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === item.id
                ? 'bg-brand-600 text-white'
                : 'text-ink-secondary hover:bg-surface hover:text-ink'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' ? <OverviewTab child={child} /> : null}
      {tab === 'attendance' ? <AttendanceTab profileId={profileId} /> : null}
      {tab === 'results' ? <ResultsTab profileId={profileId} /> : null}
      {tab === 'fees' ? <FeesTab profileId={profileId} /> : null}
      {tab === 'timetable' ? <TimetableTab profileId={profileId} /> : null}
      {tab === 'assignments' ? <AssignmentsTab profileId={profileId} /> : null}
    </div>
  );
}

// ── Shared fetch helper ──────────────────────────────────────

function useChildData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setData(null);
    setError(null);
    apiFetch<T>(path)
      .then((response) => setData(response.data))
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.status === 403 || err.status === 404
              ? 'This information is not available for your account.'
              : err.message
            : 'Failed to load',
        ),
      );
  }, [path]);
  useEffect(load, [load]);
  return { data, error, load };
}

function CardEmpty({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-card border border-line bg-surface-raised shadow-card">
      <EmptyState title={title} message={message} />
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────

function OverviewTab({ child }: { child: GuardianChildItem }) {
  const attendance = useChildData<AttendanceSummaryResponse>(
    `/attendance/summary?studentId=${child.studentProfileId}`,
  );
  const results = useChildData<ResultsResponse>(
    `/results?studentId=${child.studentProfileId}`,
  );
  const fees = useChildData<InvoiceItem[]>(
    `/fees/invoices?studentId=${child.studentProfileId}`,
  );

  const sections: StudentSectionAttendance[] =
    attendance.data?.kind === 'student' ? attendance.data.sections : [];
  const held = sections.reduce((sum, s) => sum + s.held, 0);
  const present = sections.reduce((sum, s) => sum + s.present + s.late, 0);
  const attendancePct = held > 0 ? Math.round((present / held) * 1000) / 10 : null;

  const lastRow = results.data?.rows[results.data.rows.length - 1] ?? null;
  const latestExamRows = lastRow
    ? results.data!.rows.filter((row) => row.examId === lastRow.examId)
    : [];
  const latestObtained = latestExamRows.reduce(
    (sum, row) => sum + Number(row.marksObtained),
    0,
  );
  const latestMax = latestExamRows.reduce(
    (sum, row) => sum + Number(row.maxMarks),
    0,
  );

  const activeInvoices = (fees.data ?? []).filter(
    (invoice) => invoice.status !== 'CANCELLED',
  );
  const feeBalance = activeInvoices.reduce(
    (sum, invoice) => sum + Number(invoice.balance),
    0,
  );
  const overdueCount = activeInvoices.filter(
    (invoice) => invoice.status === 'OVERDUE',
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-card border border-line bg-surface-raised p-5 shadow-card">
        <h2 className="text-sm font-semibold">Student information</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {[
            ['Name', `${child.firstName} ${child.lastName}`],
            ['Department', child.departmentName],
            ['Batch', child.batch],
            ['Admission no.', child.admissionNo],
            ['Roll no.', child.rollNo],
            ['Your relationship', child.relationship],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <OverviewStat
          label="Attendance"
          value={
            attendance.error
              ? '—'
              : !attendance.data
                ? '…'
                : attendancePct === null
                  ? 'No sessions yet'
                  : `${attendancePct}%`
          }
          tone={
            attendancePct !== null
              ? attendancePct < 75
                ? 'danger'
                : 'success'
              : undefined
          }
          href={`/children/${child.studentProfileId}?tab=attendance`}
        />
        <OverviewStat
          label="Latest published result"
          value={
            results.error
              ? '—'
              : !results.data
                ? '…'
                : lastRow === null
                  ? 'None yet'
                  : `${lastRow.examTitle}${
                      latestMax > 0
                        ? ` · ${Math.round((latestObtained / latestMax) * 1000) / 10}%`
                        : ''
                    }`
          }
          href={`/children/${child.studentProfileId}?tab=results`}
        />
        <OverviewStat
          label="Fee balance"
          value={
            fees.error
              ? '—'
              : !fees.data
                ? '…'
                : `${formatAmount(feeBalance)}${
                    overdueCount > 0
                      ? ` · ${overdueCount} overdue`
                      : ''
                  }`
          }
          tone={overdueCount > 0 ? 'danger' : feeBalance === 0 && fees.data ? 'success' : undefined}
          href={`/children/${child.studentProfileId}?tab=fees`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <OverviewStat
          label="Weekly schedule"
          value="View timetable →"
          href={`/children/${child.studentProfileId}?tab=timetable`}
        />
        <OverviewStat
          label="Coursework"
          value="View assignments →"
          href={`/children/${child.studentProfileId}?tab=assignments`}
        />
      </div>
    </div>
  );
}

function OverviewStat({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: string;
  href: string;
  tone?: 'danger' | 'success';
}) {
  return (
    <Link
      href={href}
      className="rounded-card border border-line bg-surface-raised p-4 shadow-card transition-colors hover:border-brand-300"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p
        className={`mt-1 text-sm font-semibold ${
          tone === 'danger'
            ? 'text-danger-700'
            : tone === 'success'
              ? 'text-success-700'
              : ''
        }`}
      >
        {value}
      </p>
    </Link>
  );
}

// ── Attendance ───────────────────────────────────────────────

function AttendanceTab({ profileId }: { profileId: string }) {
  const { data, error, load } = useChildData<AttendanceSummaryResponse>(
    `/attendance/summary?studentId=${profileId}`,
  );
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Skeleton rows={6} />;
  const sections = data.kind === 'student' ? data.sections : [];

  if (sections.length === 0) {
    return (
      <CardEmpty
        title="No attendance yet"
        message="Attendance appears here once their sections hold sessions."
      />
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {sections.map((section) => (
        <section
          key={section.sectionId}
          className="rounded-card border border-line bg-surface-raised p-5 shadow-card"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">
                {section.courseCode} — Section {section.sectionName}
              </h2>
              <p className="text-xs text-ink-muted">
                {section.courseTitle} · {section.termLabel}
              </p>
            </div>
            <span
              className={`text-lg font-semibold ${
                section.percentage === null
                  ? 'text-ink-faint'
                  : section.percentage >= 75
                    ? 'text-success-700'
                    : 'text-danger-700'
              }`}
            >
              {section.percentage === null ? '—' : `${section.percentage}%`}
            </span>
          </div>
          <dl className="mt-4 grid grid-cols-5 gap-2 text-center text-xs">
            {(
              [
                ['Held', section.held],
                ['Present', section.present],
                ['Absent', section.absent],
                ['Late', section.late],
                ['Excused', section.excused],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-lg bg-surface px-1 py-2">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="mt-0.5 text-sm font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

// ── Results ──────────────────────────────────────────────────

function ResultsTab({ profileId }: { profileId: string }) {
  const { data, error, load } = useChildData<ResultsResponse>(
    `/results?studentId=${profileId}`,
  );
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Skeleton rows={6} />;

  if (data.rows.length === 0) {
    return (
      <CardEmpty
        title="No published results yet"
        message="Results appear here once an exam is published by the college."
      />
    );
  }

  const byExam = new Map<string, typeof data.rows>();
  for (const row of data.rows) {
    const rows = byExam.get(row.examId) ?? [];
    rows.push(row);
    byExam.set(row.examId, rows);
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-surface-raised p-5 shadow-card">
        <div>
          <h2 className="text-sm font-semibold">{data.studentName}</h2>
          <p className="text-xs text-ink-muted">
            Overall: {data.overall.obtained}/{data.overall.max}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-2xl font-semibold tracking-tight">
            {data.overall.percentage === null ? '—' : `${data.overall.percentage}%`}
          </span>
          {data.overall.bandLabel ? (
            <Badge tone="brand">{data.overall.bandLabel}</Badge>
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
            <span className="flex gap-3">
              <Link
                href={`/results/report/${examId}?studentId=${profileId}`}
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                Report card
              </Link>
              <Link
                href={`/results/transcript?studentId=${profileId}`}
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                Transcript
              </Link>
            </span>
          </h3>
          <div className="overflow-x-auto">
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
          </div>
        </section>
      ))}
    </div>
  );
}

// ── Fees ─────────────────────────────────────────────────────

function FeesTab({ profileId }: { profileId: string }) {
  const { data, error, load } = useChildData<InvoiceItem[]>(
    `/fees/invoices?studentId=${profileId}`,
  );
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Skeleton rows={6} />;

  if (data.length === 0) {
    return (
      <CardEmpty
        title="No invoices"
        message="Fee invoices issued by the college appear here."
      />
    );
  }

  const active = data.filter((invoice) => invoice.status !== 'CANCELLED');
  const totalBalance = active.reduce(
    (sum, invoice) => sum + Number(invoice.balance),
    0,
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-surface-raised p-5 shadow-card">
        <p className="text-sm text-ink-secondary">
          Outstanding balance across {active.length} invoice
          {active.length === 1 ? '' : 's'}. Payments are recorded by the
          college office.
        </p>
        <span
          className={`text-2xl font-semibold tracking-tight ${
            totalBalance > 0 ? 'text-danger-700' : 'text-success-700'
          }`}
        >
          {formatAmount(totalBalance)}
        </span>
      </section>

      <section className="overflow-x-auto rounded-card border border-line bg-surface-raised shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              {['Invoice', 'Amount', 'Paid', 'Balance', 'Due date', 'Status'].map(
                (header) => (
                  <th
                    key={header}
                    className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted"
                  >
                    {header}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {data.map((invoice) => (
              <tr key={invoice.id} className="border-b border-line last:border-b-0">
                <td className="px-5 py-2.5">
                  <p className="font-mono text-xs">{invoice.invoiceNo}</p>
                  <p className="text-xs text-ink-muted">{invoice.structureName}</p>
                </td>
                <td className="px-5 py-2.5">{formatAmount(invoice.amount)}</td>
                <td className="px-5 py-2.5">{formatAmount(invoice.paidAmount)}</td>
                <td className="px-5 py-2.5 font-semibold">
                  {formatAmount(invoice.balance)}
                </td>
                <td className="px-5 py-2.5 text-xs text-ink-muted">
                  {formatDateTime(invoice.dueDate).split(',')[0]}
                </td>
                <td className="px-5 py-2.5">
                  <Badge tone={invoiceTone(invoice.status)}>{invoice.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ── Timetable ────────────────────────────────────────────────

const DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
];

function TimetableTab({ profileId }: { profileId: string }) {
  const { data, error, load } = useChildData<TimetableSlotItem[]>(
    `/timetable?view=student:${profileId}`,
  );
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Skeleton rows={6} />;

  if (data.length === 0) {
    return (
      <CardEmpty
        title="No timetable slots yet"
        message="Their weekly class schedule appears here once slots are set."
      />
    );
  }

  const visibleDays = DAYS.filter(
    (day) => day.value <= 5 || data.some((slot) => slot.dayOfWeek === day.value),
  );

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      {visibleDays.map((day) => {
        const daySlots = data.filter((slot) => slot.dayOfWeek === day.value);
        return (
          <section
            key={day.value}
            className="rounded-card border border-line bg-surface-raised shadow-card"
          >
            <h2 className="border-b border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {day.label}
            </h2>
            {daySlots.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-ink-faint">
                No classes
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {daySlots.map((slot) => (
                  <li key={slot.id} className="px-4 py-3">
                    <p className="font-mono text-xs text-ink-muted">
                      {slot.startTime} – {slot.endTime}
                    </p>
                    <p className="mt-0.5 text-sm font-medium">
                      {slot.courseCode} — {slot.sectionName}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {slot.room ? `${slot.room} · ` : ''}
                      {slot.teacherNames.join(', ') || 'No teacher yet'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ── Assignments ──────────────────────────────────────────────

function AssignmentsTab({ profileId }: { profileId: string }) {
  const { data, error, load } = useChildData<AssignmentItem[]>(
    `/assignments?studentId=${profileId}&limit=50`,
  );
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Skeleton rows={6} />;

  if (data.length === 0) {
    return (
      <CardEmpty
        title="No assignments"
        message="Published assignments for their sections appear here."
      />
    );
  }

  return (
    <section className="overflow-x-auto rounded-card border border-line bg-surface-raised shadow-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            {['Assignment', 'Course', 'Due', 'Points', 'Late policy'].map(
              (header) => (
                <th
                  key={header}
                  className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted"
                >
                  {header}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {data.map((assignment) => {
            const overdue = new Date(assignment.dueAt).getTime() < Date.now();
            return (
              <tr
                key={assignment.id}
                className="border-b border-line last:border-b-0"
              >
                <td className="px-5 py-2.5 font-medium">{assignment.title}</td>
                <td className="px-5 py-2.5">
                  <p>{assignment.courseCode}</p>
                  <p className="text-xs text-ink-muted">
                    Section {assignment.sectionName} · {assignment.termLabel}
                  </p>
                </td>
                <td className="px-5 py-2.5">
                  <span className={overdue ? 'text-danger-700' : ''}>
                    {formatDateTime(assignment.dueAt)}
                  </span>
                </td>
                <td className="px-5 py-2.5">{assignment.maxPoints}</td>
                <td className="px-5 py-2.5">
                  <Badge tone={assignment.allowLate ? 'neutral' : 'warning'}>
                    {assignment.allowLate ? 'Late allowed' : 'No late work'}
                  </Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
