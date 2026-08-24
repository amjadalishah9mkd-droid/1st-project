'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  AdminDashboard,
  AttendanceSummaryResponse,
  GuardianChildItem,
  InvoiceItem,
  ResultsResponse,
  StudentDashboard,
  TeacherDashboard,
  TodaySessionInfo,
} from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { formatAmount, formatDateTime } from '@/lib/format';
import { useSession } from '@/components/providers/session-provider';
import { EmptyState, ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';

/** Role dashboards (M9) — every number is a live API aggregate. */
export default function DashboardPage() {
  const { user, hasPermission } = useSession();
  if (!user) return null;
  if (hasPermission('dashboard.admin')) return <AdminView name={user.firstName} />;
  if (hasPermission('dashboard.teacher')) return <TeacherView name={user.firstName} />;
  if (hasPermission('dashboard.guardian')) return <GuardianView name={user.firstName} />;
  return <StudentView name={user.firstName} />;
}

function useDashboard<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    apiFetch<T>(path)
      .then((response) => setData(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      );
  };
  useEffect(load, [path]);
  return { data, error, load };
}

function StatTile({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: string | number;
  href?: string;
  tone?: 'danger' | 'success';
}) {
  const body = (
    <div className="rounded-card border border-line bg-surface-raised p-4 shadow-card transition-colors hover:border-brand-300">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tracking-tight ${
          tone === 'danger' ? 'text-danger-700' : tone === 'success' ? 'text-success-700' : ''
        }`}
      >
        {value}
      </p>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function TodayList({ sessions, empty }: { sessions: TodaySessionInfo[]; empty: string }) {
  if (sessions.length === 0) {
    return <p className="px-5 py-6 text-center text-sm text-ink-muted">{empty}</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {sessions.map((session) => (
        <li key={`${session.sectionId}-${session.startTime}`} className="flex items-center justify-between gap-3 px-5 py-2.5">
          <div>
            <p className="text-sm font-medium">{session.sectionLabel}</p>
            <p className="font-mono text-xs text-ink-muted">
              {session.startTime}–{session.endTime}
              {session.room ? ` · ${session.room}` : ''}
            </p>
          </div>
          <Badge
            tone={
              session.status === 'HELD'
                ? 'success'
                : session.status === 'CANCELLED'
                  ? 'danger'
                  : 'neutral'
            }
          >
            {session.status === 'NOT_GENERATED' ? 'PLANNED' : session.status}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function Panel({ title, children, href }: { title: string; children: React.ReactNode; href?: string }) {
  return (
    <section className="rounded-card border border-line bg-surface-raised shadow-card">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {href ? (
          <Link href={href} className="text-xs font-medium text-brand-700 hover:underline">
            View all
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

// ── Admin ────────────────────────────────────────────────────

function AdminView({ name }: { name: string }) {
  const { data, error, load } = useDashboard<AdminDashboard>('/dashboards/admin');
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Skeleton rows={8} />;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {name}</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          College overview{data.currentTermLabel ? ` · ${data.currentTermLabel}` : ''}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Students" value={data.students} href="/students" />
        <StatTile label="Teachers" value={data.teachers} href="/teachers" />
        <StatTile label="Active courses" value={data.courses} href="/courses" />
        <StatTile label="Sections" value={data.sections} href="/sections" />
        <StatTile
          label="Attendance rate"
          value={data.attendanceRate === null ? '—' : `${data.attendanceRate}%`}
          href="/attendance"
          tone={data.attendanceRate !== null && data.attendanceRate < 75 ? 'danger' : 'success'}
        />
        <StatTile
          label="Fees outstanding"
          value={formatAmount(data.fees.outstanding)}
          href="/fees"
          tone={Number(data.fees.outstanding) > 0 ? 'danger' : 'success'}
        />
        <StatTile
          label="Open reports"
          value={data.openReports}
          href="/moderation"
          tone={data.openReports > 0 ? 'danger' : 'success'}
        />
        <StatTile label="Upcoming events" value={data.upcomingEvents} href="/community/events" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Fee collection" href="/fees">
          <dl className="space-y-2 px-5 py-4 text-sm">
            {[
              ['Invoiced', formatAmount(data.fees.invoiced)],
              ['Collected', formatAmount(data.fees.collected)],
              ['Outstanding', formatAmount(data.fees.outstanding)],
              ['Overdue invoices', String(data.fees.overdueCount)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title="Academics" href="/exams">
          <dl className="space-y-2 px-5 py-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">Published exams</dt>
              <dd className="font-semibold">{data.publishedExams}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">College attendance</dt>
              <dd className="font-semibold">
                {data.attendanceRate === null ? 'No sessions yet' : `${data.attendanceRate}%`}
              </dd>
            </div>
          </dl>
        </Panel>
      </div>
    </div>
  );
}

// ── Teacher ──────────────────────────────────────────────────

function TeacherView({ name }: { name: string }) {
  const { data, error, load } = useDashboard<TeacherDashboard>('/dashboards/teacher');
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Skeleton rows={8} />;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {name}</h1>
        <p className="mt-1 text-sm text-ink-secondary">Your teaching day at a glance.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="My sections" value={data.sections} href="/sections" />
        <StatTile label="My students" value={data.students} />
        <StatTile
          label="Pending grading"
          value={data.pendingGrading}
          href="/assignments"
          tone={data.pendingGrading > 0 ? 'danger' : 'success'}
        />
        <StatTile
          label="Class attendance"
          value={data.attendanceRate === null ? '—' : `${data.attendanceRate}%`}
          href="/attendance"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Today's classes" href="/attendance">
          <TodayList sessions={data.todaySessions} empty="No classes scheduled today." />
        </Panel>
        <Panel title="Assignments" href="/assignments">
          <dl className="space-y-2 px-5 py-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">Open (due in the future)</dt>
              <dd className="font-semibold">{data.openAssignments}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">Submissions awaiting grades</dt>
              <dd className="font-semibold">{data.pendingGrading}</dd>
            </div>
          </dl>
        </Panel>
      </div>
    </div>
  );
}

// ── Student ──────────────────────────────────────────────────

function StudentView({ name }: { name: string }) {
  const { data, error, load } = useDashboard<StudentDashboard>('/dashboards/student');
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Skeleton rows={8} />;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {name}</h1>
        <p className="mt-1 text-sm text-ink-secondary">Your day at a glance.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="My sections" value={data.sections} href="/sections" />
        <StatTile
          label="My attendance"
          value={data.attendanceRate === null ? '—' : `${data.attendanceRate}%`}
          href="/attendance"
          tone={
            data.attendanceRate !== null && data.attendanceRate < 75 ? 'danger' : 'success'
          }
        />
        <StatTile
          label="Fee balance"
          value={formatAmount(data.feeBalance)}
          href="/fees"
          tone={Number(data.feeBalance) > 0 ? 'danger' : 'success'}
        />
        <StatTile label="Published results" value={data.publishedResults} href="/results" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Today's classes" href="/timetable">
          <TodayList sessions={data.todayClasses} empty="No classes today — enjoy it." />
        </Panel>
        <Panel title="Due soon" href="/assignments">
          {data.pendingAssignments.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-ink-muted">
              Nothing pending. All assignments submitted.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {data.pendingAssignments.map((assignment) => (
                <li key={assignment.id}>
                  <Link
                    href={`/assignments/${assignment.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-surface"
                  >
                    <div>
                      <p className="text-sm font-medium">{assignment.title}</p>
                      <p className="text-xs text-ink-muted">{assignment.courseCode}</p>
                    </div>
                    <span className="text-xs text-warning-700">
                      {formatDateTime(assignment.dueAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {data.nextEvent ? (
        <Link
          href="/community/events"
          className="rounded-card border border-brand-200 bg-brand-50/50 px-5 py-4 text-sm shadow-card transition-colors hover:border-brand-300"
        >
          📅 Next event: <span className="font-semibold">{data.nextEvent.title}</span>{' '}
          <span className="text-ink-muted">· {formatDateTime(data.nextEvent.startsAt)}</span>
        </Link>
      ) : null}
    </div>
  );
}

// ── Guardian (M13-W4) ────────────────────────────────────────

interface ChildOverviewStats {
  attendancePct: number | null;
  latestExam: { title: string; percentage: number | null; band: string | null } | null;
  feeBalance: number | null;
  feeOverdue: boolean;
}

/**
 * Per-child overview assembled client-side from the W3 CHILD-scoped APIs —
 * no new backend aggregation. Each fetch is independent; a failure in one
 * stat degrades to "—" instead of breaking the card.
 */
function useChildStats(studentProfileId: string): ChildOverviewStats | null {
  const [stats, setStats] = useState<ChildOverviewStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<AttendanceSummaryResponse>(
        `/attendance/summary?studentId=${studentProfileId}`,
      ).then(
        (r) => r.data,
        () => null,
      ),
      apiFetch<ResultsResponse>(`/results?studentId=${studentProfileId}`).then(
        (r) => r.data,
        () => null,
      ),
      apiFetch<InvoiceItem[]>(`/fees/invoices?studentId=${studentProfileId}`).then(
        (r) => r.data,
        () => null,
      ),
    ]).then(([attendance, results, invoices]) => {
      if (cancelled) return;
      let attendancePct: number | null = null;
      if (attendance && attendance.kind === 'student') {
        const held = attendance.sections.reduce((sum, s) => sum + s.held, 0);
        const present = attendance.sections.reduce(
          (sum, s) => sum + s.present + s.late,
          0,
        );
        attendancePct = held > 0 ? Math.round((present / held) * 1000) / 10 : null;
      }
      let latestExam: ChildOverviewStats['latestExam'] = null;
      if (results && results.rows.length > 0) {
        const lastRow = results.rows[results.rows.length - 1];
        const examRows = results.rows.filter((row) => row.examId === lastRow.examId);
        const obtained = examRows.reduce((sum, r) => sum + Number(r.marksObtained), 0);
        const max = examRows.reduce((sum, r) => sum + Number(r.maxMarks), 0);
        latestExam = {
          title: lastRow.examTitle,
          percentage: max > 0 ? Math.round((obtained / max) * 1000) / 10 : null,
          band: results.overall.bandLabel,
        };
      }
      let feeBalance: number | null = null;
      let feeOverdue = false;
      if (invoices) {
        feeBalance = invoices
          .filter((invoice) => invoice.status !== 'CANCELLED')
          .reduce((sum, invoice) => sum + Number(invoice.balance), 0);
        feeOverdue = invoices.some((invoice) => invoice.status === 'OVERDUE');
      }
      setStats({ attendancePct, latestExam, feeBalance, feeOverdue });
    });
    return () => {
      cancelled = true;
    };
  }, [studentProfileId]);
  return stats;
}

function GuardianChildCard({ child }: { child: GuardianChildItem }) {
  const stats = useChildStats(child.studentProfileId);
  return (
    <section className="rounded-card border border-line bg-surface-raised p-5 shadow-card transition-colors hover:border-brand-300">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            {child.firstName} {child.lastName}
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            {child.departmentName} · Batch {child.batch}
          </p>
          <p className="font-mono text-xs text-ink-muted">
            Roll {child.rollNo} · Adm {child.admissionNo}
          </p>
        </div>
        <Badge tone="brand">{child.relationship}</Badge>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        <div className="rounded-lg bg-surface px-3 py-2">
          <dt className="text-xs text-ink-muted">Attendance</dt>
          <dd
            className={`mt-0.5 font-semibold ${
              stats?.attendancePct != null && stats.attendancePct < 75
                ? 'text-danger-700'
                : stats?.attendancePct != null
                  ? 'text-success-700'
                  : ''
            }`}
          >
            {stats === null ? '…' : stats.attendancePct === null ? '—' : `${stats.attendancePct}%`}
          </dd>
        </div>
        <div className="rounded-lg bg-surface px-3 py-2">
          <dt className="text-xs text-ink-muted">Latest result</dt>
          <dd className="mt-0.5 font-semibold">
            {stats === null
              ? '…'
              : stats.latestExam === null
                ? '—'
                : `${stats.latestExam.title}${
                    stats.latestExam.percentage === null
                      ? ''
                      : ` · ${stats.latestExam.percentage}%`
                  }`}
          </dd>
        </div>
        <div className="rounded-lg bg-surface px-3 py-2">
          <dt className="text-xs text-ink-muted">Fee balance</dt>
          <dd
            className={`mt-0.5 font-semibold ${
              stats?.feeOverdue ? 'text-danger-700' : ''
            }`}
          >
            {stats === null
              ? '…'
              : stats.feeBalance === null
                ? '—'
                : formatAmount(stats.feeBalance)}
            {stats?.feeOverdue ? ' · overdue' : ''}
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <Link
          href={`/children/${child.studentProfileId}`}
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          View {child.firstName}&rsquo;s details →
        </Link>
      </div>
    </section>
  );
}

function GuardianView({ name }: { name: string }) {
  const { data, error, load } = useDashboard<GuardianChildItem[]>('/guardian/children');
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Skeleton rows={6} />;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {name}</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          {data.length === 0
            ? 'Your guardian account is active.'
            : `An overview of ${data.length === 1 ? 'your child' : 'your children'} at a glance.`}
        </p>
      </div>

      {data.length === 0 ? (
        <div className="rounded-card border border-line bg-surface-raised shadow-card">
          <EmptyState
            title="No linked children"
            message="When the college links a student to your account, their information appears here."
          />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((child) => (
            <GuardianChildCard key={child.studentProfileId} child={child} />
          ))}
        </div>
      )}
    </div>
  );
}
