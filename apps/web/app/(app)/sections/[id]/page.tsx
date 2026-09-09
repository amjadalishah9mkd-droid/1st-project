'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  createSlotSchema,
  type SectionOverview,
  type StudentItem,
  type TeacherItem,
} from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useOptions } from '@/lib/hooks/use-list';
import { formValues, useZodForm } from '@/lib/hooks/use-zod-form';
import { useSession } from '@/components/providers/session-provider';
import { useToast } from '@/components/providers/toast-provider';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
type Tab = 'roster' | 'teachers' | 'timetable';

export default function SectionHubPage() {
  const params = useParams<{ id: string }>();
  const { hasPermission } = useSession();
  const canEnroll = hasPermission('enrollment.manage');
  const canManageTimetable = hasPermission('timetable.manage');
  const { toast } = useToast();
  const [overview, setOverview] = useState<SectionOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('roster');
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [slotOpen, setSlotOpen] = useState(false);
  const [slotRemoval, setSlotRemoval] = useState<{ id: string; label: string } | null>(null);
  const [removal, setRemoval] = useState<
    | { kind: 'student'; id: string; name: string }
    | { kind: 'teacher'; id: string; name: string }
    | null
  >(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<SectionOverview>(`/sections/${params.id}/overview`)
      .then((response) => setOverview(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      )
      .finally(() => setLoading(false));
  }, [params.id]);

  useEffect(load, [load]);

  if (loading) return <Skeleton rows={10} />;
  if (error || !overview)
    return <ErrorState message={error ?? 'Not found'} onRetry={load} />;

  async function removeMember() {
    if (!removal) return;
    setRemoving(true);
    try {
      await apiFetch(
        removal.kind === 'student'
          ? `/sections/${params.id}/enrollments/${removal.id}`
          : `/sections/${params.id}/teachers/${removal.id}`,
        { method: 'DELETE' },
      );
      toast(
        removal.kind === 'student'
          ? `${removal.name} removed from the roster`
          : `${removal.name} unassigned`,
      );
      setRemoval(null);
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Action failed', 'error');
    } finally {
      setRemoving(false);
    }
  }

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'roster', label: `Roster (${overview.students.length})` },
    { key: 'teachers', label: `Teachers (${overview.teachers.length})` },
    { key: 'timetable', label: `Timetable (${overview.timetableSlots.length})` },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`${overview.course.code} — Section ${overview.name}`}
        description={`${overview.course.title} · ${overview.term.label}`}
      />

      {/* Overview strip */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Department', `${overview.department.code} — ${overview.department.name}`],
          ['Enrollment', `${overview.enrolledCount} / ${overview.capacity}`],
          ['Room', overview.room ?? 'Not set'],
          ['Credits', String(overview.course.credits)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-card border border-line bg-surface-raised p-4 shadow-card">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
            <p className="mt-1 text-sm font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="mb-4 flex items-center justify-between border-b border-line">
        <div className="flex gap-1" role="tablist">
          {tabs.map((entry) => (
            <button
              key={entry.key}
              role="tab"
              aria-selected={tab === entry.key}
              onClick={() => setTab(entry.key)}
              className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === entry.key
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-ink-muted hover:text-ink'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {canEnroll || canManageTimetable ? (
          <div className="flex gap-2 pb-2">
            {tab === 'roster' && canEnroll ? (
              <Button size="sm" onClick={() => setEnrollOpen(true)}>
                Enroll student
              </Button>
            ) : tab === 'teachers' && canEnroll ? (
              <Button size="sm" onClick={() => setAssignOpen(true)}>
                Assign teacher
              </Button>
            ) : tab === 'timetable' && canManageTimetable ? (
              <Button size="sm" onClick={() => setSlotOpen(true)}>
                Add slot
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-card border border-line bg-surface-raised shadow-card">
        {tab === 'roster' ? (
          overview.students.length === 0 ? (
            <EmptyState
              title="No students enrolled"
              message="Enroll students to build this section's roster."
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  {['Roll no', 'Name', 'Admission no', ''].map((header) => (
                    <th key={header} className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {overview.students.map((student) => (
                  <tr key={student.enrollmentId} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-3 font-mono">{student.rollNo}</td>
                    <td className="px-4 py-3 font-medium">{student.name}</td>
                    <td className="px-4 py-3">{student.admissionNo}</td>
                    <td className="px-4 py-3 text-right">
                      {canEnroll ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setRemoval({ kind: 'student', id: student.studentId, name: student.name })
                          }
                        >
                          Remove
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : tab === 'teachers' ? (
          overview.teachers.length === 0 ? (
            <EmptyState
              title="No teachers assigned"
              message="Assign a teacher so this section can be taught."
            />
          ) : (
            <ul className="divide-y divide-line">
              {overview.teachers.map((teacher) => (
                <li key={teacher.assignmentId} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">
                      {teacher.name}{' '}
                      {teacher.isPrimary ? <Badge tone="brand">Primary</Badge> : null}
                    </p>
                    <p className="text-xs text-ink-muted">{teacher.designation}</p>
                  </div>
                  {canEnroll ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setRemoval({ kind: 'teacher', id: teacher.teacherId, name: teacher.name })
                      }
                    >
                      Unassign
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        ) : overview.timetableSlots.length === 0 ? (
          <EmptyState
            title="No timetable yet"
            message={
              canManageTimetable
                ? 'Add weekly slots for this section.'
                : 'Weekly slots for this section have not been scheduled yet.'
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {overview.timetableSlots.map((slot) => (
              <li key={slot.id} className="flex items-center gap-4 px-4 py-3 text-sm">
                <span className="w-12 font-semibold">{DAY_NAMES[slot.dayOfWeek]}</span>
                <span>
                  {slot.startTime} – {slot.endTime}
                </span>
                <span className="flex-1 text-ink-muted">
                  {slot.room ?? overview.room ?? ''}
                </span>
                {canManageTimetable ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setSlotRemoval({
                        id: slot.id,
                        label: `${DAY_NAMES[slot.dayOfWeek]} ${slot.startTime}–${slot.endTime}`,
                      })
                    }
                  >
                    Delete
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canEnroll ? (
        <>
          <EnrollDialog
            open={enrollOpen}
            sectionId={params.id}
            excludeIds={overview.students.map((s) => s.studentId)}
            onClose={() => setEnrollOpen(false)}
            onDone={(name) => {
              setEnrollOpen(false);
              toast(`${name} enrolled`);
              load();
            }}
          />
          <AssignTeacherDialog
            open={assignOpen}
            sectionId={params.id}
            excludeIds={overview.teachers.map((t) => t.teacherId)}
            onClose={() => setAssignOpen(false)}
            onDone={(name) => {
              setAssignOpen(false);
              toast(`${name} assigned`);
              load();
            }}
          />
          <ConfirmDialog
            open={removal !== null}
            title={removal?.kind === 'student' ? 'Remove student' : 'Unassign teacher'}
            message={
              removal?.kind === 'student'
                ? `Remove ${removal.name} from this section? Their enrollment is marked as dropped, not deleted.`
                : `Unassign ${removal?.name} from this section?`
            }
            confirmLabel={removal?.kind === 'student' ? 'Remove' : 'Unassign'}
            busy={removing}
            onConfirm={removeMember}
            onClose={() => setRemoval(null)}
          />
        </>
      ) : null}

      {canManageTimetable ? (
        <>
          <AddSlotDialog
            open={slotOpen}
            sectionId={params.id}
            defaultRoom={overview.room}
            onClose={() => setSlotOpen(false)}
            onDone={() => {
              setSlotOpen(false);
              toast('Slot added');
              load();
            }}
          />
          <ConfirmDialog
            open={slotRemoval !== null}
            title="Delete slot"
            message={`Delete the ${slotRemoval?.label} slot? Slots with existing sessions cannot be deleted.`}
            confirmLabel="Delete"
            onConfirm={async () => {
              if (!slotRemoval) return;
              try {
                await apiFetch(`/timetable/slots/${slotRemoval.id}`, {
                  method: 'DELETE',
                });
                toast('Slot deleted');
                setSlotRemoval(null);
                load();
              } catch (err) {
                toast(err instanceof ApiError ? err.message : 'Delete failed', 'error');
                setSlotRemoval(null);
              }
            }}
            onClose={() => setSlotRemoval(null)}
          />
        </>
      ) : null}

      <p className="mt-4 text-xs text-ink-muted">
        Course status: {overview.course.status} ·{' '}
        <Link href={`/courses/${overview.course.id}`} className="text-brand-700 hover:underline">
          View course
        </Link>
      </p>
    </div>
  );
}

function AddSlotDialog({
  open,
  sectionId,
  defaultRoom,
  onClose,
  onDone,
}: {
  open: boolean;
  sectionId: string;
  defaultRoom: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const form = useZodForm(createSlotSchema);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = formValues(event.currentTarget);
    raw.sectionId = sectionId;
    const input = form.validate(raw);
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch('/timetable/slots', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    });
    if (done) onDone();
  }

  return (
    <Dialog
      open={open}
      title="Add timetable slot"
      description="Conflicts within this section and room clashes in the same term are rejected."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Select
          label="Day"
          name="dayOfWeek"
          options={[
            { value: '1', label: 'Monday' },
            { value: '2', label: 'Tuesday' },
            { value: '3', label: 'Wednesday' },
            { value: '4', label: 'Thursday' },
            { value: '5', label: 'Friday' },
            { value: '6', label: 'Saturday' },
            { value: '7', label: 'Sunday' },
          ]}
          error={form.fieldErrors.dayOfWeek}
        />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Start time" name="startTime" type="time" error={form.fieldErrors.startTime} />
          <Input label="End time" name="endTime" type="time" error={form.fieldErrors.endTime} />
        </div>
        <Input
          label="Room (optional)"
          name="room"
          defaultValue={defaultRoom ?? ''}
          error={form.fieldErrors.room}
        />
        {form.formError ? (
          <p className="rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700" role="alert">
            {form.formError}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={form.busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.busy}>
            {form.busy ? 'Adding…' : 'Add slot'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EnrollDialog({
  open,
  sectionId,
  excludeIds,
  onClose,
  onDone,
}: {
  open: boolean;
  sectionId: string;
  excludeIds: string[];
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const students = useOptions<StudentItem>('/students', open);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = students.filter((s) => !excludeIds.includes(s.id));

  async function submit() {
    if (!selected) {
      setError('Choose a student');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/sections/${sectionId}/enrollments/${selected}`, {
        method: 'POST',
      });
      const student = candidates.find((s) => s.id === selected);
      onDone(student ? `${student.firstName} ${student.lastName}` : 'Student');
      setSelected('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enrollment failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title="Enroll student" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Select
          label="Student"
          placeholder={candidates.length ? 'Select student' : 'No eligible students'}
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          options={candidates.map((s) => ({
            value: s.id,
            label: `${s.rollNo} — ${s.firstName} ${s.lastName}`,
          }))}
          error={error ?? undefined}
        />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || candidates.length === 0}>
            {busy ? 'Enrolling…' : 'Enroll'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function AssignTeacherDialog({
  open,
  sectionId,
  excludeIds,
  onClose,
  onDone,
}: {
  open: boolean;
  sectionId: string;
  excludeIds: string[];
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const teachers = useOptions<TeacherItem>('/teachers', open);
  const [selected, setSelected] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = teachers.filter((t) => !excludeIds.includes(t.id));

  async function submit() {
    if (!selected) {
      setError('Choose a teacher');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/sections/${sectionId}/teachers/${selected}`, {
        method: 'POST',
        body: JSON.stringify({ isPrimary }),
      });
      const teacher = candidates.find((t) => t.id === selected);
      onDone(teacher ? `${teacher.firstName} ${teacher.lastName}` : 'Teacher');
      setSelected('');
      setIsPrimary(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Assignment failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title="Assign teacher" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Select
          label="Teacher"
          placeholder={candidates.length ? 'Select teacher' : 'No eligible teachers'}
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          options={candidates.map((t) => ({
            value: t.id,
            label: `${t.employeeNo} — ${t.firstName} ${t.lastName}`,
          }))}
          error={error ?? undefined}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isPrimary}
            onChange={(event) => setIsPrimary(event.target.checked)}
            className="h-4 w-4 rounded border-line-strong"
          />
          Primary teacher for this section
        </label>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || candidates.length === 0}>
            {busy ? 'Assigning…' : 'Assign'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
