'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createCourseSchema,
  type CourseItem,
  type DepartmentItem,
} from '@campusos/shared';
import { apiFetch } from '@/lib/api/client';
import { useList, useOptions } from '@/lib/hooks/use-list';
import { formValues, useZodForm } from '@/lib/hooks/use-zod-form';
import { useToast } from '@/components/providers/toast-provider';
import { useSession } from '@/components/providers/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data/data-table';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export default function CoursesPage() {
  const list = useList<CourseItem>('/courses');
  const { hasPermission } = useSession();
  const canManage = hasPermission('academics.manage');
  const departments = useOptions<DepartmentItem>('/departments', canManage);
  const router = useRouter();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Courses"
        description="The course catalog across departments."
        actions={
          canManage ? (
            <Button onClick={() => setCreateOpen(true)}>Add course</Button>
          ) : undefined
        }
      />

      <DataTable
        rowKey={(row) => row.id}
        rows={list.rows}
        meta={list.meta}
        loading={list.loading}
        error={list.error}
        search={list.search}
        onSearchChange={list.onSearchChange}
        searchPlaceholder="Search code or title…"
        onPageChange={list.setPage}
        onRetry={list.refetch}
        onRowClick={(row) => router.push(`/courses/${row.id}`)}
        emptyTitle="No courses found"
        emptyMessage="Courses appear here once they are added to the catalog."
        columns={[
          { key: 'code', header: 'Code', render: (row) => <span className="font-mono font-medium">{row.code}</span> },
          { key: 'title', header: 'Title', render: (row) => row.title },
          { key: 'department', header: 'Department', render: (row) => row.departmentName },
          { key: 'credits', header: 'Credits', render: (row) => row.credits },
          { key: 'sections', header: 'Sections', render: (row) => row.sectionCount },
          {
            key: 'status',
            header: 'Status',
            render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge>,
          },
        ]}
      />

      {canManage ? (
        <CreateCourseDialog
          open={createOpen}
          departments={departments}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            toast('Course created');
            list.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateCourseDialog({
  open,
  departments,
  onClose,
  onSaved,
}: {
  open: boolean;
  departments: DepartmentItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useZodForm(createCourseSchema);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = form.validate(formValues(event.currentTarget));
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch('/courses', { method: 'POST', body: JSON.stringify(input) });
    });
    if (done) onSaved();
  }

  return (
    <Dialog open={open} title="Add course" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Select
          label="Department"
          name="departmentId"
          placeholder="Select department"
          options={departments.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` }))}
          error={form.fieldErrors.departmentId}
        />
        <Input label="Code" name="code" placeholder="CS-201" error={form.fieldErrors.code} />
        <Input label="Title" name="title" error={form.fieldErrors.title} />
        <Input label="Credits" name="credits" type="number" min={1} max={12} defaultValue={3} error={form.fieldErrors.credits} />
        <div className="sm:col-span-2">
          <Input label="Description (optional)" name="description" error={form.fieldErrors.description} />
        </div>
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
            {form.busy ? 'Creating…' : 'Create course'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
