'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  AttendanceSheet,
  AttendanceSummaryResponse,
  SectionItem,
  SessionItem,
  StudentSectionAttendance,
} from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useOptions } from '@/lib/hooks/use-list';
import { useSession } from '@/components/providers/session-provider';
import { useToast } from '@/components/providers/toast-provider';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';

const STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const;
type Status = (typeof STATUSES)[number];

const statusStyles: Record<Status, string> = {
  PRESENT: 'bg-success-50 text-success-700 border-success-500/40',
  ABSENT: 'bg-danger-50 text-danger-700 border-danger-500/40',
  LATE: 'bg-warning-50 text-warning-700 border-warning-500/40',
  EXCUSED: 'bg-surface-sunken text-ink-secondary border-line-strong',
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AttendancePage() {
  const { hasPermission } = useSession();
  const canRecord = hasPermission('attendance.record');
  return canRecord ? <RecorderView /> : <StudentSummaryView />;
}

// ── Teacher/Admin: session management + attendance sheet ─────

function RecorderView() {
  const { user } = useSession();
  const { toast } = useToast();
  const isTeacher = user?.teacherProfile !== null;
  const sections = useOptions<SectionItem>(
    isTeacher ? '/sections?mine=true' : '/sections',
  );
  const [sectionId, setSectionId] = useState('');
  const [weekOf, setWeekOf] = useState(todayIso());
  const [sessions, setSessions] = useState<SessionItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [sheetSessionId, setSheetSessionId] = useState<string | null>(null);

  const loadSessions = useCallback(
    (targetSectionId: string) => {
      if (!targetSectionId) return;
      setLoading(true);
      setError(null);
      apiFetch<SessionItem[]>(`/sections/${targetSectionId}/sessions`)
        .then((response) => setSessions(response.data))
        .catch((err) =>
          setError(err instanceof ApiError ? err.message : 'Failed to load'),
        )
        .finally(() => setLoading(false));
    },
    [],
  );

  useEffect(() => {
    if (!sectionId && sections.length > 0) {
      setSectionId(sections[0].id);
      loadSessions(sections[0].id);
    }
  }, [sections, sectionId, loadSessions]);

  async function generateWeek() {
    if (!sectionId) return;
    setGenerating(true);
    try {
      const response = await apiFetch<{ created: number }>(
        `/sections/${sectionId}/sessions/generate?weekOf=${weekOf}`,
        { method: 'POST' },
      );
      toast(
        response.data.created > 0
          ? `${response.data.created} session(s) created for that week`
          : 'Sessions for that week already exist',
        'info',
      );
      loadSessions(sectionId);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Generation failed', 'error');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Attendance"
        description="Generate class sessions from the timetable, then record attendance per session."
      />

      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface-raised p-4 shadow-card">
        <div className="min-w-56 flex-1">
          <Select
            label="Section"
            value={sectionId}
            onChange={(event) => {
              setSectionId(event.target.value);
              loadSessions(event.target.value);
            }}
            placeholder={sections.length ? undefined : 'No sections available'}
            options={sections.map((section) => ({
              value: section.id,
              label: `${section.courseCode} — Section ${section.name} (${section.termLabel})`,
            }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="weekOf" className="text-sm font-medium">
            Week of
          </label>
          <input
            id="weekOf"
            type="date"
            value={weekOf}
            onChange={(event) => setWeekOf(event.target.value)}
            className="h-10 rounded-lg border border-line-strong bg-surface-raised px-3 text-sm"
          />
        </div>
        <Button onClick={generateWeek} disabled={!sectionId || generating}>
          {generating ? 'Generating…' : 'Generate sessions'}
        </Button>
      </div>

      <div className="rounded-card border border-line bg-surface-raised shadow-card">
        {!sectionId ? (
          <EmptyState
            title="Choose a section"
            message="Sessions for the selected section appear here."
          />
        ) : loading ? (
          <Skeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={() => loadSessions(sectionId)} />
        ) : !sessions || sessions.length === 0 ? (
          <EmptyState
            title="No sessions yet"
            message="Generate sessions for a week using the timetable slots."
          />
        ) : (
          <ul className="divide-y divide-line">
            {sessions.map((session) => (
              <li
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">
                    {session.date} · {session.startTime}–{session.endTime}
                    {session.room ? ` · ${session.room}` : ''}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {session.status === 'HELD'
                      ? `Recorded ${session.recordedCount}/${session.enrolledCount}${
                          session.absentCount > 0
                            ? ` · ${session.absentCount} absent`
                            : ''
                        }${session.takenByName ? ` · by ${session.takenByName}` : ''}`
                      : session.status === 'CANCELLED'
                        ? 'Cancelled'
                        : 'Not taken yet'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    tone={
                      session.status === 'HELD'
                        ? 'success'
                        : session.status === 'CANCELLED'
                          ? 'danger'
                          : 'neutral'
                    }
                  >
                    {session.status}
                  </Badge>
                  {session.status !== 'CANCELLED' ? (
                    <Button
                      size="sm"
                      variant={session.status === 'HELD' ? 'secondary' : 'primary'}
                      onClick={() => setSheetSessionId(session.id)}
                    >
                      {session.status === 'HELD' ? 'Edit' : 'Take attendance'}
                    </Button>
                  ) : null}
                  {session.status === 'SCHEDULED' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await apiFetch(`/sessions/${session.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ status: 'CANCELLED' }),
                          });
                          toast('Session cancelled');
                          loadSessions(sectionId);
                        } catch (err) {
                          toast(
                            err instanceof ApiError ? err.message : 'Failed',
                            'error',
                          );
                        }
                      }}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {sheetSessionId ? (
        <AttendanceSheetDialog
          sessionId={sheetSessionId}
          onClose={() => setSheetSessionId(null)}
          onSaved={() => {
            setSheetSessionId(null);
            toast('Attendance saved');
            loadSessions(sectionId);
          }}
        />
      ) : null}
    </div>
  );
}

function AttendanceSheetDialog({
  sessionId,
  onClose,
  onSaved,
}: {
  sessionId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sheet, setSheet] = useState<AttendanceSheet | null>(null);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<AttendanceSheet>(`/sessions/${sessionId}/attendance`)
      .then((response) => {
        setSheet(response.data);
        const initial: Record<string, Status> = {};
        for (const entry of response.data.entries) {
          initial[entry.studentId] = (entry.status as Status) ?? 'PRESENT';
        }
        setStatuses(initial);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      );
  }, [sessionId]);

  async function save() {
    if (!sheet) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/sessions/${sessionId}/attendance`, {
        method: 'PUT',
        body: JSON.stringify({
          records: sheet.entries.map((entry) => ({
            studentId: entry.studentId,
            status: statuses[entry.studentId] ?? 'PRESENT',
          })),
        }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title={
        sheet
          ? `${sheet.courseCode} — Section ${sheet.sectionName} · ${sheet.session.date}`
          : 'Attendance'
      }
      description={sheet ? `${sheet.session.startTime}–${sheet.session.endTime}` : undefined}
      onClose={onClose}
      wide
    >
      {!sheet && !error ? (
        <Skeleton rows={5} />
      ) : error && !sheet ? (
        <ErrorState message={error} />
      ) : sheet && sheet.entries.length === 0 ? (
        <EmptyState
          title="No students enrolled"
          message="Enroll students in this section before taking attendance."
        />
      ) : sheet ? (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setStatuses(
                  Object.fromEntries(
                    sheet.entries.map((entry) => [entry.studentId, 'PRESENT']),
                  ),
                )
              }
            >
              Mark all present
            </Button>
          </div>
          <ul className="max-h-96 divide-y divide-line overflow-y-auto rounded-card border border-line">
            {sheet.entries.map((entry) => (
              <li
                key={entry.studentId}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
              >
                <div>
                  <p className="text-sm font-medium">{entry.name}</p>
                  <p className="font-mono text-xs text-ink-muted">{entry.rollNo}</p>
                </div>
                <div className="flex gap-1" role="radiogroup" aria-label={`Status for ${entry.name}`}>
                  {STATUSES.map((status) => (
                    <button
                      key={status}
                      type="button"
                      role="radio"
                      aria-checked={statuses[entry.studentId] === status}
                      onClick={() =>
                        setStatuses((current) => ({
                          ...current,
                          [entry.studentId]: status,
                        }))
                      }
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        statuses[entry.studentId] === status
                          ? statusStyles[status]
                          : 'border-line bg-surface text-ink-faint hover:text-ink-secondary'
                      }`}
                    >
                      {status.charAt(0) + status.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {error ? (
            <p className="rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save attendance'}
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

// ── Student: own summary ─────────────────────────────────────

function StudentSummaryView() {
  const [sections, setSections] = useState<StudentSectionAttendance[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setSections(null);
    setError(null);
    apiFetch<AttendanceSummaryResponse>('/attendance/summary')
      .then((response) => {
        if (response.data.kind === 'student') setSections(response.data.sections);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      );
  };
  useEffect(load, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!sections) return <Skeleton rows={6} />;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="My attendance"
        description="Attendance across your enrolled sections, based on held sessions."
      />
      {sections.length === 0 ? (
        <div className="rounded-card border border-line bg-surface-raised shadow-card">
          <EmptyState
            title="No attendance yet"
            message="Once your sections hold sessions, your attendance appears here."
          />
        </div>
      ) : (
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
                {[
                  ['Held', section.held],
                  ['Present', section.present],
                  ['Absent', section.absent],
                  ['Late', section.late],
                  ['Excused', section.excused],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-surface px-1 py-2">
                    <dt className="text-ink-muted">{label}</dt>
                    <dd className="mt-0.5 text-sm font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
