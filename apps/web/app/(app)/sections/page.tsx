'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createSectionSchema,
  type CourseItem,
  type SectionItem,
  type TermItem,
} from '@campusos/shared';
import { apiFetch } from '@/lib/api/client';
import { useList, useOptions } from '@/lib/hooks/use-list';
import { formValues, useZodForm } from '@/lib/hooks/use-zod-form';
import { useToast } from '@/components/providers/toast-provider';
import { useSession } from '@/components/providers/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data/data-table';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export default function SectionsPage() {
  const list = useList<SectionItem>('/sections');
  const { hasPermission, user } = useSession();
  const canManage = hasPermission('academics.manage');
  const courses = useOptions<CourseItem>('/courses', canManage);
  const terms = useOptions<TermItem>('/terms', canManage);
  const router = useRouter();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  const isStudentView = user?.studentProfile !== null && !canManage;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Sections"
        description={
          isStudentView
            ? 'Sections you are enrolled in.'
            : 'Course offerings per term.'
        }
        actions={
          canManage ? (
            <Button onClick={() => setCreateOpen(true)}>Add section</Button>
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
        searchPlaceholder="Search course or section…"
        onPageChange={list.setPage}
        onRetry={list.refetch}
        onRowClick={(row) => router.push(`/sections/${row.id}`)}
        emptyTitle="No sections found"
        emptyMessage={
          isStudentView
            ? 'You are not enrolled in any section this term.'
            : 'Create sections to open course offerings for the term.'
        }
        columns={[
          {
            key: 'course',
            header: 'Course',
            render: (row) => (
              <div>
                <p className="font-medium">
                  {row.courseCode} — Section {row.name}
                </p>
                <p className="text-xs text-ink-muted">{row.courseTitle}</p>
              </div>
            ),
          },
          { key: 'term', header: 'Term', render: (row) => row.termLabel },
          { key: 'department', header: 'Department', render: (row) => row.departmentName },
          {
            key: 'enrolled',
            header: 'Enrolled',
            render: (row) => `${row.enrolledCount}/${row.capacity}`,
          },
          {
            key: 'teachers',
            header: 'Teachers',
            render: (row) => row.teacherNames.join(', ') || '—',
          },
          { key: 'room', header: 'Room', render: (row) => row.room ?? '—' },
        ]}
      />

      {canManage ? (
        <CreateSectionDialog
          open={createOpen}
          courses={courses.filter((course) => course.status === 'ACTIVE')}
          terms={terms}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            toast('Section created');
            list.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateSectionDialog({
  open,
  courses,
  terms,
  onClose,
  onSaved,
}: {
  open: boolean;
  courses: CourseItem[];
  terms: TermItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useZodForm(createSectionSchema);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = form.validate(formValues(event.currentTarget));
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch('/sections', { method: 'POST', body: JSON.stringify(input) });
    });
    if (done) onSaved();
  }

  return (
    <Dialog open={open} title="Add section" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Select
          label="Course"
          name="courseId"
          placeholder="Select course"
          options={courses.map((course) => ({
            value: course.id,
            label: `${course.code} — ${course.title}`,
          }))}
          error={form.fieldErrors.courseId}
        />
        <Select
          label="Term"
          name="termId"
          placeholder="Select term"
          options={terms.map((term) => ({
            value: term.id,
            label: `${term.label}${term.isCurrent ? ' (current)' : ''}`,
          }))}
          error={form.fieldErrors.termId}
        />
        <Input label="Section name" name="name" placeholder="A" error={form.fieldErrors.name} />
        <Input label="Capacity" name="capacity" type="number" min={1} defaultValue={30} error={form.fieldErrors.capacity} />
        <Input label="Room (optional)" name="room" error={form.fieldErrors.room} />
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
            {form.busy ? 'Creating…' : 'Create section'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
