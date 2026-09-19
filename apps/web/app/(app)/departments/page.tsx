'use client';

import { FormEvent, useState } from 'react';
import { createDepartmentSchema, type DepartmentItem } from '@campusos/shared';
import { apiFetch } from '@/lib/api/client';
import { useList } from '@/lib/hooks/use-list';
import { formValues, useZodForm } from '@/lib/hooks/use-zod-form';
import { useToast } from '@/components/providers/toast-provider';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data/data-table';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export default function DepartmentsPage() {
  const list = useList<DepartmentItem>('/departments');
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<DepartmentItem | null>(null);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Departments"
        description="Academic departments and their headline numbers."
        actions={<Button onClick={() => setCreateOpen(true)}>Add department</Button>}
      />

      <DataTable
        rowKey={(row) => row.id}
        rows={list.rows}
        meta={list.meta}
        loading={list.loading}
        error={list.error}
        search={list.search}
        onSearchChange={list.onSearchChange}
        searchPlaceholder="Search name or code…"
        onPageChange={list.setPage}
        onRetry={list.refetch}
        emptyTitle="No departments yet"
        emptyMessage="Departments anchor courses, teachers and students."
        columns={[
          { key: 'code', header: 'Code', render: (row) => <span className="font-mono font-medium">{row.code}</span> },
          { key: 'name', header: 'Name', render: (row) => row.name },
          { key: 'head', header: 'Head', render: (row) => row.headTeacherName ?? '—' },
          { key: 'courses', header: 'Courses', render: (row) => row.courseCount },
          { key: 'teachers', header: 'Teachers', render: (row) => row.teacherCount },
          { key: 'students', header: 'Students', render: (row) => row.studentCount },
          {
            key: 'actions',
            header: '',
            className: 'w-20 text-right',
            render: (row) => (
              <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
                Edit
              </Button>
            ),
          },
        ]}
      />

      <DepartmentDialog
        open={createOpen || editing !== null}
        department={editing}
        onClose={() => {
          setCreateOpen(false);
          setEditing(null);
        }}
        onSaved={(created) => {
          setCreateOpen(false);
          setEditing(null);
          toast(created ? 'Department created' : 'Department updated');
          list.refetch();
        }}
      />
    </div>
  );
}

function DepartmentDialog({
  open,
  department,
  onClose,
  onSaved,
}: {
  open: boolean;
  department: DepartmentItem | null;
  onClose: () => void;
  onSaved: (created: boolean) => void;
}) {
  const form = useZodForm(createDepartmentSchema);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = formValues(event.currentTarget);
    if (department) raw.code = department.code; // code is immutable
    const input = form.validate(raw);
    if (!input) return;
    const done = await form.submit(async () => {
      if (department) {
        await apiFetch(`/departments/${department.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: input.name }),
        });
      } else {
        await apiFetch('/departments', {
          method: 'POST',
          body: JSON.stringify(input),
        });
      }
    });
    if (done) onSaved(department === null);
  }

  return (
    <Dialog
      open={open}
      title={department ? `Edit ${department.code}` : 'Add department'}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input
          label="Name"
          name="name"
          defaultValue={department?.name ?? ''}
          key={department?.id ?? 'new'}
          error={form.fieldErrors.name}
        />
        {!department ? (
          <Input
            label="Code"
            name="code"
            placeholder="CS"
            hint="Unique within the college; cannot be changed later."
            error={form.fieldErrors.code}
          />
        ) : null}
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
            {form.busy ? 'Saving…' : department ? 'Save changes' : 'Create department'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
