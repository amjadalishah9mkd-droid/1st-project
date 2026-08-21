'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  updateTeacherSchema,
  type DepartmentItem,
  type TeacherDetail,
} from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useOptions } from '@/lib/hooks/use-list';
import { formValues, useZodForm } from '@/lib/hooks/use-zod-form';
import { useSession } from '@/components/providers/session-provider';
import { useToast } from '@/components/providers/toast-provider';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export default function TeacherDetailPage() {
  const params = useParams<{ id: string }>();
  const { hasPermission } = useSession();
  const canManage = hasPermission('users.manage');
  const { toast } = useToast();
  const [teacher, setTeacher] = useState<TeacherDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const departments = useOptions<DepartmentItem>('/departments', canManage);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<TeacherDetail>(`/teachers/${params.id}`)
      .then((response) => setTeacher(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      )
      .finally(() => setLoading(false));
  }, [params.id]);

  useEffect(load, [load]);

  if (loading) return <Skeleton rows={8} />;
  if (error || !teacher)
    return <ErrorState message={error ?? 'Not found'} onRetry={load} />;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`${teacher.firstName} ${teacher.lastName}`}
        description={`${teacher.designation} · ${teacher.departmentName}`}
        actions={
          canManage ? <Button onClick={() => setEditOpen(true)}>Edit</Button> : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-card border border-line bg-surface-raised p-5 shadow-card">
          <h2 className="text-sm font-semibold">Profile</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {[
              ['Email', teacher.email],
              ['Phone', teacher.phone ?? '—'],
              ['Employee no', teacher.employeeNo],
              ['Designation', teacher.designation],
              ['Qualification', teacher.qualification ?? '—'],
              ['Department', teacher.departmentName],
              ['Joined on', teacher.joinedOn],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-card border border-line bg-surface-raised p-5 shadow-card">
          <h2 className="text-sm font-semibold">
            Teaching assignments ({teacher.assignments.length})
          </h2>
          {teacher.assignments.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              No sections assigned yet.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line text-sm">
              {teacher.assignments.map((assignment) => (
                <li key={assignment.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <Link
                      href={`/sections/${assignment.sectionId}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {assignment.courseCode} — Section {assignment.sectionName}
                    </Link>
                    <p className="text-xs text-ink-muted">
                      {assignment.courseTitle} · {assignment.termLabel}
                    </p>
                  </div>
                  {assignment.isPrimary ? <Badge tone="brand">Primary</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {canManage ? (
        <EditTeacherDialog
          open={editOpen}
          teacher={teacher}
          departments={departments}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            toast('Teacher updated');
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function EditTeacherDialog({
  open,
  teacher,
  departments,
  onClose,
  onSaved,
}: {
  open: boolean;
  teacher: TeacherDetail;
  departments: DepartmentItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useZodForm(updateTeacherSchema);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = form.validate(formValues(event.currentTarget));
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch(`/teachers/${teacher.id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
    });
    if (done) onSaved();
  }

  return (
    <Dialog open={open} title="Edit teacher" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Input label="First name" name="firstName" defaultValue={teacher.firstName} error={form.fieldErrors.firstName} />
        <Input label="Last name" name="lastName" defaultValue={teacher.lastName} error={form.fieldErrors.lastName} />
        <Select
          label="Department"
          name="departmentId"
          defaultValue={teacher.departmentId}
          options={departments.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` }))}
          error={form.fieldErrors.departmentId}
        />
        <Input label="Designation" name="designation" defaultValue={teacher.designation} error={form.fieldErrors.designation} />
        <Input label="Qualification" name="qualification" defaultValue={teacher.qualification ?? ''} error={form.fieldErrors.qualification} />
        <Input label="Joined on" name="joinedOn" type="date" defaultValue={teacher.joinedOn} error={form.fieldErrors.joinedOn} />
        <Input label="Phone" name="phone" defaultValue={teacher.phone ?? ''} error={form.fieldErrors.phone} />
        {form.formError ? (
          <p className="sm:col-span-2 rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700" role="alert">
            {form.formError}
          </p>
        ) : null}
        <div className="sm:col-span-2 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={form.busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.busy}>
            {form.busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
