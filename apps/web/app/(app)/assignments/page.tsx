'use client';

import { FormEvent, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createAssignmentSchema,
  type AssignmentItem,
  type SectionItem,
  type UploadedFileInfo,
} from '@campusos/shared';
import { apiFetch } from '@/lib/api/client';
import { uploadFile } from '@/lib/api/upload';
import { useList, useOptions } from '@/lib/hooks/use-list';
import { formValues, useZodForm } from '@/lib/hooks/use-zod-form';
import { useToast } from '@/components/providers/toast-provider';
import { useSession } from '@/components/providers/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { assignmentStatus, formatDue } from './assignment-utils';

export default function AssignmentsPage() {
  const { user, hasPermission } = useSession();
  const canManage = hasPermission('assignments.manage');
  const isStudent = user?.studentProfile !== null;
  const list = useList<AssignmentItem>('/assignments');
  const sections = useOptions<SectionItem>(
    user?.teacherProfile ? '/sections?mine=true' : '/sections',
    canManage,
  );
  const router = useRouter();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Assignments"
        description={
          isStudent
            ? 'Assignments across your enrolled sections.'
            : canManage
              ? 'Create, publish and grade assignments for your sections.'
              : 'Assignment oversight across the college.'
        }
        actions={
          canManage ? (
            <Button onClick={() => setCreateOpen(true)}>New assignment</Button>
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
        searchPlaceholder="Search title…"
        onPageChange={list.setPage}
        onRetry={list.refetch}
        onRowClick={(row) => router.push(`/assignments/${row.id}`)}
        emptyTitle="No assignments"
        emptyMessage={
          canManage
            ? 'Create your first assignment for one of your sections.'
            : 'Nothing has been assigned yet.'
        }
        columns={[
          {
            key: 'title',
            header: 'Assignment',
            render: (row) => (
              <div>
                <p className="font-medium">{row.title}</p>
                <p className="text-xs text-ink-muted">
                  {row.courseCode} — Section {row.sectionName}
                </p>
              </div>
            ),
          },
          {
            key: 'due',
            header: 'Due',
            render: (row) => (
              <span className="text-sm">{formatDue(row.dueAt)}</span>
            ),
          },
          { key: 'points', header: 'Points', render: (row) => row.maxPoints },
          ...(isStudent
            ? []
            : [
                {
                  key: 'progress',
                  header: 'Submissions',
                  render: (row: AssignmentItem) =>
                    `${row.submissionCount}/${row.enrolledCount} · ${row.gradedCount} graded`,
                },
              ]),
          {
            key: 'status',
            header: 'Status',
            render: (row) => {
              const status = assignmentStatus(row);
              return <Badge tone={status.tone}>{status.label}</Badge>;
            },
          },
        ]}
      />

      {canManage ? (
        <CreateAssignmentDialog
          open={createOpen}
          sections={sections}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            toast('Assignment created as draft');
            list.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateAssignmentDialog({
  open,
  sections,
  onClose,
  onSaved,
}: {
  open: boolean;
  sections: SectionItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useZodForm(createAssignmentSchema);
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachment, setAttachment] = useState<UploadedFileInfo | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleAttach() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      setAttachment(await uploadFile(file));
    } catch {
      form.setFormError('Attachment upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = formValues(event.currentTarget);
    raw.allowLate = raw.allowLate === 'on';
    raw.attachments = attachment
      ? [{ name: attachment.name, url: attachment.url, size: attachment.size }]
      : [];
    if (typeof raw.dueAt === 'string' && raw.dueAt) {
      raw.dueAt = new Date(raw.dueAt as string).toISOString();
    }
    const input = form.validate(raw);
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch('/assignments', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    });
    if (done) {
      setAttachment(null);
      onSaved();
    }
  }

  return (
    <Dialog
      open={open}
      title="New assignment"
      description="Created as a draft — students see it only after you publish."
      onClose={onClose}
      wide
    >
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <Select
            label="Section"
            name="sectionId"
            placeholder="Select section"
            options={sections.map((section) => ({
              value: section.id,
              label: `${section.courseCode} — Section ${section.name} (${section.termLabel})`,
            }))}
            error={form.fieldErrors.sectionId}
          />
        </div>
        <div className="sm:col-span-2">
          <Input label="Title" name="title" error={form.fieldErrors.title} />
        </div>
        <div className="sm:col-span-2 flex flex-col gap-1.5">
          <label htmlFor="description" className="text-sm font-medium">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            rows={4}
            className={`rounded-lg border bg-surface-raised px-3 py-2 text-sm ${
              form.fieldErrors.description
                ? 'border-danger-500'
                : 'border-line-strong'
            }`}
          />
          {form.fieldErrors.description ? (
            <p className="text-xs text-danger-700">{form.fieldErrors.description}</p>
          ) : null}
        </div>
        <Input
          label="Due date & time"
          name="dueAt"
          type="datetime-local"
          error={form.fieldErrors.dueAt}
        />
        <Input
          label="Max points"
          name="maxPoints"
          type="number"
          min={1}
          defaultValue={100}
          error={form.fieldErrors.maxPoints}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="allowLate" className="h-4 w-4 rounded border-line-strong" />
          Allow late submissions (marked as late)
        </label>
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            aria-label="Attachment"
            className="flex-1 text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-surface-sunken file:px-2 file:py-1.5 file:text-xs"
            onChange={handleAttach}
          />
          {uploading ? (
            <span className="text-xs text-ink-muted">Uploading…</span>
          ) : attachment ? (
            <span className="text-xs text-success-700">✓ {attachment.name}</span>
          ) : null}
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
          <Button type="submit" disabled={form.busy || uploading}>
            {form.busy ? 'Creating…' : 'Create draft'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
