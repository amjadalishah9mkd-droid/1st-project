'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  updateStudentSchema,
  type DepartmentItem,
  type StudentDetail,
} from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useOptions } from '@/lib/hooks/use-list';
import { formValues, useZodForm } from '@/lib/hooks/use-zod-form';
import { useSession } from '@/components/providers/session-provider';
import { useToast } from '@/components/providers/toast-provider';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ResetLinkButton } from '@/components/invite-link-dialog';
import { GuardiansCard } from '@/components/guardians-card';

export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  const { hasPermission } = useSession();
  const canManage = hasPermission('users.manage');
  const { toast } = useToast();
  const [student, setStudent] = useState<StudentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const departments = useOptions<DepartmentItem>('/departments', canManage);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<StudentDetail>(`/students/${params.id}`)
      .then((response) => setStudent(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      )
      .finally(() => setLoading(false));
  }, [params.id]);

  useEffect(load, [load]);

  if (loading) return <Skeleton rows={8} />;
  if (error || !student)
    return <ErrorState message={error ?? 'Not found'} onRetry={load} />;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`${student.firstName} ${student.lastName}`}
        description={`${student.rollNo} · ${student.departmentName} · Batch ${student.batch}`}
        actions={
          canManage ? (
            <div className="flex gap-3">
              <ResetLinkButton
                userId={student.userId}
                personName={`${student.firstName} ${student.lastName}`}
              />
              <Button onClick={() => setEditOpen(true)}>Edit</Button>
            </div>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-card border border-line bg-surface-raised p-5 shadow-card">
          <h2 className="text-sm font-semibold">Profile</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {[
              ['Email', student.email],
              ['Phone', student.phone ?? '—'],
              ['Admission no', student.admissionNo],
              ['Roll no', student.rollNo],
              ['Batch', student.batch],
              ['Department', student.departmentName],
              ['Date of birth', student.dateOfBirth ?? '—'],
              ['Emergency contact', student.guardianName ?? '—'],
              ['Emergency contact phone', student.guardianPhone ?? '—'],
              ['Address', student.address ?? '—'],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Status</dt>
              <dd>
                <Badge tone={statusTone(student.status)}>{student.status}</Badge>
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-card border border-line bg-surface-raised p-5 shadow-card">
          <h2 className="text-sm font-semibold">
            Enrollments ({student.enrollments.length})
          </h2>
          {student.enrollments.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              Not enrolled in any section yet.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line text-sm">
              {student.enrollments.map((enrollment) => (
                <li key={enrollment.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <Link
                      href={`/sections/${enrollment.sectionId}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {enrollment.courseCode} — Section {enrollment.sectionName}
                    </Link>
                    <p className="text-xs text-ink-muted">
                      {enrollment.courseTitle} · {enrollment.termLabel}
                    </p>
                  </div>
                  <Badge tone={statusTone(enrollment.status)}>
                    {enrollment.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {canManage ? (
        <div className="mt-4">
          <GuardiansCard studentProfileId={student.id} />
        </div>
      ) : null}

      {canManage ? (
        <EditStudentDialog
          open={editOpen}
          student={student}
          departments={departments}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            toast('Student updated');
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function EditStudentDialog({
  open,
  student,
  departments,
  onClose,
  onSaved,
}: {
  open: boolean;
  student: StudentDetail;
  departments: DepartmentItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useZodForm(updateStudentSchema);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = form.validate(formValues(event.currentTarget));
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch(`/students/${student.id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
    });
    if (done) onSaved();
  }

  return (
    <Dialog open={open} title="Edit student" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Input label="First name" name="firstName" defaultValue={student.firstName} error={form.fieldErrors.firstName} />
        <Input label="Last name" name="lastName" defaultValue={student.lastName} error={form.fieldErrors.lastName} />
        <Select
          label="Department"
          name="departmentId"
          defaultValue={student.departmentId}
          options={departments.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` }))}
          error={form.fieldErrors.departmentId}
        />
        <Input label="Roll no" name="rollNo" defaultValue={student.rollNo} error={form.fieldErrors.rollNo} />
        <Input label="Batch" name="batch" defaultValue={student.batch} error={form.fieldErrors.batch} />
        <Select
          label="Status"
          name="status"
          defaultValue={student.status}
          options={['ENROLLED', 'GRADUATED', 'WITHDRAWN', 'SUSPENDED'].map((s) => ({ value: s, label: s }))}
          error={form.fieldErrors.status}
        />
        <Input label="Phone" name="phone" defaultValue={student.phone ?? ''} error={form.fieldErrors.phone} />
        <Input label="Emergency contact name" name="guardianName" defaultValue={student.guardianName ?? ''} error={form.fieldErrors.guardianName} />
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
