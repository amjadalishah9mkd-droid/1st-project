'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type {
  CourseItem,
  RolloverPlanInput,
  RolloverPreview,
  RolloverSectionPreview,
} from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useOptions } from '@/lib/hooks/use-list';
import { useToast } from '@/components/providers/toast-provider';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

/**
 * M15-W3 — rollover wizard (/calendar/rollover/[termId]).
 * Pure consumer of the W2 API; the backend stays the sole authority for
 * validation, tenancy and execution. The plan sent via PATCH is rebuilt
 * from the server preview + local edits — never invented client-side.
 */

type SectionEdit = {
  action: 'CLONE' | 'MAP' | 'SKIP';
  targetCourseId: string | null;
  targetName: string;
  graduateStudents: boolean;
  carryTeachers: boolean;
  carriedTeacherIds: Set<string>;
  students: Map<
    string,
    { decision: 'CARRY' | 'HOLD' | 'EXCLUDE'; holdSourceSectionId: string | null }
  >;
};

function editsFromPreview(preview: RolloverPreview): Map<string, SectionEdit> {
  const map = new Map<string, SectionEdit>();
  for (const section of preview.sections) {
    map.set(section.sourceSectionId, {
      action: section.action,
      targetCourseId: section.targetCourseId,
      targetName: section.targetName,
      graduateStudents: section.graduateStudents,
      carryTeachers: section.carryTeachers,
      carriedTeacherIds: new Set(
        section.teachers.filter((t) => t.carried).map((t) => t.teacherId),
      ),
      students: new Map(
        section.students.map((s) => [
          s.studentId,
          { decision: s.decision, holdSourceSectionId: s.holdSourceSectionId },
        ]),
      ),
    });
  }
  return map;
}

function planFromEdits(edits: Map<string, SectionEdit>): RolloverPlanInput {
  return {
    sections: [...edits.entries()].map(([sourceSectionId, edit]) => ({
      sourceSectionId,
      action: edit.action,
      ...(edit.action === 'MAP' && edit.targetCourseId
        ? { targetCourseId: edit.targetCourseId }
        : {}),
      targetName: edit.targetName || undefined,
      graduateStudents: edit.graduateStudents,
      carryTeachers: edit.carryTeachers,
      teacherIds: [...edit.carriedTeacherIds],
      students: [...edit.students.entries()].map(([studentId, s]) => ({
        studentId,
        decision: s.decision,
        ...(s.decision === 'HOLD' && s.holdSourceSectionId
          ? { holdSourceSectionId: s.holdSourceSectionId }
          : {}),
      })),
    })),
  };
}

export default function RolloverWizardPage() {
  const params = useParams<{ termId: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const courses = useOptions<CourseItem>('/courses');
  const [preview, setPreview] = useState<RolloverPreview | null>(null);
  const [edits, setEdits] = useState<Map<string, SectionEdit> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [executing, setExecuting] = useState(false);

  const load = useCallback(() => {
    setError(null);
    apiFetch<RolloverPreview>(`/terms/${params.termId}/rollover`)
      .then((response) => {
        setPreview(response.data);
        setEdits(editsFromPreview(response.data));
        setDirty(false);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load rollover'),
      );
  }, [params.termId]);
  useEffect(load, [load]);

  const mutateSection = useCallback(
    (sectionId: string, patch: (edit: SectionEdit) => void) => {
      setEdits((prev) => {
        if (!prev) return prev;
        const next = new Map(prev);
        const edit = next.get(sectionId);
        if (!edit) return prev;
        const copy: SectionEdit = {
          ...edit,
          carriedTeacherIds: new Set(edit.carriedTeacherIds),
          students: new Map(edit.students),
        };
        patch(copy);
        next.set(sectionId, copy);
        return next;
      });
      setDirty(true);
    },
    [],
  );

  // Live local summary so the admin sees consequences while editing.
  const summary = useMemo(() => {
    if (!preview || !edits) return null;
    let sectionsToCreate = 0;
    let carry = 0;
    let holds = 0;
    let excluded = 0;
    let graduates = 0;
    let suspended = 0;
    let teachers = 0;
    let skipped = 0;
    for (const section of preview.sections) {
      const edit = edits.get(section.sourceSectionId)!;
      if (edit.action === 'SKIP') skipped += 1;
      else {
        sectionsToCreate += 1;
        if (edit.carryTeachers) teachers += edit.carriedTeacherIds.size;
      }
      for (const student of section.students) {
        const decision = student.locked
          ? { decision: 'EXCLUDE' as const }
          : edit.students.get(student.studentId) ?? { decision: student.decision };
        if (student.status === 'SUSPENDED' && decision.decision !== 'EXCLUDE') suspended += 1;
        if (decision.decision === 'EXCLUDE' || student.locked) excluded += 1;
        else if (edit.action === 'SKIP') skipped += 0;
        else if (edit.graduateStudents) graduates += 1;
        else if (decision.decision === 'HOLD') holds += 1;
        else carry += 1;
      }
    }
    return { sectionsToCreate, carry, holds, excluded, graduates, suspended, teachers, skipped };
  }, [preview, edits]);

  const carriedSections = useMemo(
    () =>
      preview && edits
        ? preview.sections.filter(
            (s) => edits.get(s.sourceSectionId)?.action !== 'SKIP',
          )
        : [],
    [preview, edits],
  );

  async function savePlan(): Promise<boolean> {
    if (!edits || saving) return false;
    setSaving(true);
    try {
      const response = await apiFetch<RolloverPreview>(
        `/terms/${params.termId}/rollover`,
        { method: 'PATCH', body: JSON.stringify(planFromEdits(edits)) },
      );
      setPreview(response.data);
      setEdits(editsFromPreview(response.data));
      setDirty(false);
      toast('Plan saved');
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ALREADY_EXECUTED') {
        toast('This rollover was already executed — reloading.', 'error');
        load();
      } else {
        toast(err instanceof ApiError ? err.message : 'Could not save the plan', 'error');
      }
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function execute() {
    if (!preview || executing) return;
    setExecuting(true);
    try {
      if (dirty) {
        const saved = await savePlan();
        if (!saved) return;
      }
      const response = await apiFetch<RolloverPreview>(
        `/terms/${params.termId}/rollover/execute`,
        { method: 'POST', body: JSON.stringify({ confirmLabel: confirmText }) },
      );
      setPreview(response.data);
      setConfirmOpen(false);
      toast('Rollover executed');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ALREADY_EXECUTED') {
        toast('This rollover was already executed — reloading.', 'error');
        setConfirmOpen(false);
        load();
      } else if (err instanceof ApiError && err.code === 'CONFIRMATION_MISMATCH') {
        toast('The confirmation text does not match the destination term label.', 'error');
      } else {
        toast(
          err instanceof ApiError
            ? `${err.message} — the draft is preserved; no partial rollover remains.`
            : 'Execution failed — the draft is preserved; no partial rollover remains.',
          'error',
        );
      }
    } finally {
      setExecuting(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!preview || !edits) return <Skeleton rows={10} />;

  if (preview.status === 'EXECUTED') {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Rollover complete"
          description={`${preview.fromTermLabel} → ${preview.toTermLabel}`}
        />
        <section className="rounded-card border border-line bg-surface-raised p-6 shadow-card" role="status">
          <Badge tone="success">EXECUTED</Badge>
          <h2 className="mt-3 text-lg font-semibold">The new term is ready.</h2>
          {preview.counters ? (
            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              {Object.entries(preview.counters).map(([key, value]) => (
                <div key={key} className="rounded-lg bg-surface px-3 py-2">
                  <dt className="text-xs text-ink-muted">{key}</dt>
                  <dd className="font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <p className="mt-4 text-sm text-ink-secondary">
            Next steps: set “{preview.toTermLabel}” as the current term from the
            calendar, build its timetables, and generate its fee invoices —
            rollover deliberately touches none of those.
          </p>
          <div className="mt-5 flex gap-3">
            <Link href="/calendar">
              <Button>Back to calendar</Button>
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`Rollover: ${preview.fromTermLabel} → ${preview.toTermLabel}`}
        description="Review every mapping below, save the plan, then execute with typed confirmation. Rollover does not create or modify fees, invoices, payments, or timetables."
        actions={
          <>
            <Button variant="secondary" onClick={savePlan} disabled={saving || !dirty}>
              {saving ? 'Saving…' : dirty ? 'Save plan' : 'Plan saved'}
            </Button>
            <Button onClick={() => setConfirmOpen(true)} disabled={saving || executing}>
              Execute rollover…
            </Button>
          </>
        }
      />

      {summary ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {(
            [
              ['New sections', summary.sectionsToCreate],
              ['Carried', summary.carry],
              ['Held back', summary.holds],
              ['Excluded', summary.excluded],
              ['Graduating', summary.graduates],
              ['Suspended ⚠', summary.suspended],
              ['Teacher links', summary.teachers],
              ['Skipped sections', summary.skipped],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-card border border-line bg-surface-raised p-3 shadow-card">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</p>
              <p className="mt-0.5 text-xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {preview.sections.length === 0 ? (
        <EmptyState title="Nothing to roll over" message="The source term has no sections." />
      ) : (
        <div className="flex flex-col gap-5">
          {preview.sections.map((section) => (
            <SectionCard
              key={section.sourceSectionId}
              section={section}
              edit={edits.get(section.sourceSectionId)!}
              courses={courses}
              carriedSections={carriedSections}
              onChange={(patch) => mutateSection(section.sourceSectionId, patch)}
            />
          ))}
        </div>
      )}

      <Dialog
        open={confirmOpen}
        title="Execute rollover"
        description={`This creates the new term's sections, enrolls students, carries teachers, completes ${preview.fromTermLabel}'s enrollments and graduates any students marked for graduation. It does NOT touch fees, invoices, payments or timetables. This cannot be re-run once executed.`}
        onClose={() => (executing ? undefined : setConfirmOpen(false))}
      >
        <div className="flex flex-col gap-4">
          {summary && summary.graduates > 0 ? (
            <p className="rounded-card border border-warning-500/40 bg-surface px-4 py-3 text-sm" role="alert">
              <strong>{summary.graduates}</strong> student{summary.graduates === 1 ? '' : 's'} will
              become GRADUATED and will not receive a new-term enrollment.
            </p>
          ) : null}
          <Input
            label={`Type the destination term label to confirm: “${preview.toTermLabel}”`}
            name="confirmLabel"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder={preview.toTermLabel}
          />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={executing}>
              Cancel
            </Button>
            <Button
              onClick={execute}
              disabled={executing || confirmText !== preview.toTermLabel}
            >
              {executing ? 'Executing…' : 'Execute rollover'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

// ── Section mapping card ─────────────────────────────────────

function SectionCard({
  section,
  edit,
  courses,
  carriedSections,
  onChange,
}: {
  section: RolloverSectionPreview;
  edit: SectionEdit;
  courses: CourseItem[];
  carriedSections: RolloverSectionPreview[];
  onChange: (patch: (edit: SectionEdit) => void) => void;
}) {
  const skipped = edit.action === 'SKIP';
  return (
    <section className="rounded-card border border-line bg-surface-raised shadow-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold">
            {section.courseCode} — Section {section.sourceName}
            <span className="ml-2 text-xs font-normal text-ink-muted">(source term)</span>
          </h2>
          <p className="text-xs text-ink-muted">
            {section.courseTitle} · {section.students.length} students ·{' '}
            {section.teachers.length} teacher{section.teachers.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {edit.graduateStudents ? <Badge tone="warning">Final — graduates</Badge> : null}
          {skipped ? <Badge tone="neutral">Skipped</Badge> : <Badge tone="brand">Will be created</Badge>}
        </div>
      </header>

      <div className="grid gap-4 px-5 py-4 lg:grid-cols-[280px,1fr]">
        {/* Destination mapping */}
        <div className="flex flex-col gap-3">
          <Select
            label="Mapping"
            value={edit.action}
            onChange={(event) =>
              onChange((e) => {
                e.action = event.target.value as SectionEdit['action'];
                if (e.action !== 'MAP') e.targetCourseId = null;
              })
            }
            options={[
              { value: 'CLONE', label: `Same course (${section.courseCode})` },
              { value: 'MAP', label: 'Different course…' },
              { value: 'SKIP', label: 'Do not carry' },
            ]}
          />
          {edit.action === 'MAP' ? (
            <Select
              label="Destination course"
              value={edit.targetCourseId ?? ''}
              onChange={(event) => onChange((e) => (e.targetCourseId = event.target.value || null))}
              placeholder="Select destination course"
              options={courses.map((course) => ({
                value: course.id,
                label: `${course.code} — ${course.title}`,
              }))}
            />
          ) : null}
          {!skipped ? (
            <>
              <Input
                label="Destination section name"
                name={`name-${section.sourceSectionId}`}
                value={edit.targetName}
                onChange={(event) => onChange((e) => (e.targetName = event.target.value))}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={edit.graduateStudents}
                  onChange={(event) =>
                    onChange((e) => (e.graduateStudents = event.target.checked))
                  }
                />
                <span>
                  Final section — <strong>students graduate</strong> instead of enrolling
                </span>
              </label>
              <div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={edit.carryTeachers}
                    onChange={(event) => onChange((e) => (e.carryTeachers = event.target.checked))}
                  />
                  Carry teachers
                </label>
                {edit.carryTeachers && section.teachers.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1 pl-6 text-sm">
                    {section.teachers.map((teacher) => (
                      <li key={teacher.teacherId}>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={edit.carriedTeacherIds.has(teacher.teacherId)}
                            onChange={(event) =>
                              onChange((e) => {
                                if (event.target.checked) e.carriedTeacherIds.add(teacher.teacherId);
                                else e.carriedTeacherIds.delete(teacher.teacherId);
                              })
                            }
                          />
                          {teacher.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-xs text-ink-muted">
              This section will not exist in {`the destination term`}; its students end the
              source term without a mapped destination here.
            </p>
          )}
        </div>

        {/* Students */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Students
          </p>
          {section.students.length === 0 ? (
            <p className="text-sm text-ink-muted">No active students.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line text-sm">
              {section.students.map((student) => {
                const decision = edit.students.get(student.studentId) ?? {
                  decision: student.decision,
                  holdSourceSectionId: student.holdSourceSectionId,
                };
                return (
                  <li
                    key={student.studentId}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <div>
                      <span className="font-medium">{student.name}</span>{' '}
                      <span className="text-xs text-ink-muted">({student.rollNo})</span>
                      {student.status === 'SUSPENDED' ? (
                        <span className="ml-2 inline-block align-middle">
                          <Badge tone="warning">Suspended — review</Badge>
                        </span>
                      ) : null}
                      {student.locked ? (
                        <span className="ml-2 inline-block align-middle">
                          <Badge tone="neutral">{student.status} — excluded</Badge>
                        </span>
                      ) : null}
                    </div>
                    {!student.locked ? (
                      <div className="flex items-center gap-2">
                        <Select
                          label=""
                          value={decision.decision}
                          onChange={(event) =>
                            onChange((e) =>
                              e.students.set(student.studentId, {
                                decision: event.target.value as 'CARRY' | 'HOLD' | 'EXCLUDE',
                                holdSourceSectionId:
                                  event.target.value === 'HOLD'
                                    ? decision.holdSourceSectionId
                                    : null,
                              }),
                            )
                          }
                          options={[
                            { value: 'CARRY', label: 'Carry' },
                            { value: 'HOLD', label: 'Hold back…' },
                            { value: 'EXCLUDE', label: 'Exclude' },
                          ]}
                        />
                        {decision.decision === 'HOLD' ? (
                          <Select
                            label=""
                            value={decision.holdSourceSectionId ?? ''}
                            onChange={(event) =>
                              onChange((e) =>
                                e.students.set(student.studentId, {
                                  decision: 'HOLD',
                                  holdSourceSectionId: event.target.value || null,
                                }),
                              )
                            }
                            placeholder="Repeat destination"
                            options={carriedSections.map((s) => ({
                              value: s.sourceSectionId,
                              label: `${s.courseCode} ${s.targetName}`,
                            }))}
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
