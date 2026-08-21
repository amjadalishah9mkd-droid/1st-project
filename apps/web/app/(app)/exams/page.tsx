'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createExamSchema,
  type ExamItem,
  type TermItem,
} from '@campusos/shared';
import { apiFetch } from '@/lib/api/client';
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
import { examStatusTone } from './exam-utils';

export default function ExamsPage() {
  const { hasPermission } = useSession();
  const canManage = hasPermission('exams.manage');
  const list = useList<ExamItem>('/exams');
  const terms = useOptions<TermItem>('/terms', canManage);
  const router = useRouter();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Exams"
        description={
          canManage
            ? 'Schedule exams, add papers per section, and publish results.'
            : 'Exams with papers in your sections — enter marks until results are published.'
        }
        actions={
          canManage ? (
            <Button onClick={() => setCreateOpen(true)}>New exam</Button>
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
        searchPlaceholder="Search exams…"
        onPageChange={list.setPage}
        onRetry={list.refetch}
        onRowClick={(row) => router.push(`/exams/${row.id}`)}
        emptyTitle="No exams"
        emptyMessage={
          canManage
            ? 'Create an exam for the current term to get started.'
            : 'No exams involve your sections yet.'
        }
        columns={[
          {
            key: 'title',
            header: 'Exam',
            render: (row) => (
              <div>
                <p className="font-medium">{row.title}</p>
                <p className="text-xs text-ink-muted">
                  {row.type.charAt(0) + row.type.slice(1).toLowerCase()} · {row.termLabel}
                </p>
              </div>
            ),
          },
          { key: 'papers', header: 'Papers', render: (row) => row.paperCount },
          { key: 'marks', header: 'Marks entered', render: (row) => row.markCount },
          {
            key: 'status',
            header: 'Status',
            render: (row) => (
              <Badge tone={examStatusTone(row.status)}>{row.status}</Badge>
            ),
          },
        ]}
      />

      {canManage ? (
        <CreateExamDialog
          open={createOpen}
          terms={terms}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            toast('Exam created');
            list.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateExamDialog({
  open,
  terms,
  onClose,
  onSaved,
}: {
  open: boolean;
  terms: TermItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useZodForm(createExamSchema);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = form.validate(formValues(event.currentTarget));
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch('/exams', { method: 'POST', body: JSON.stringify(input) });
    });
    if (done) onSaved();
  }

  return (
    <Dialog open={open} title="New exam" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input label="Title" name="title" placeholder="Midterm Examination" error={form.fieldErrors.title} />
        <Select
          label="Type"
          name="type"
          options={['QUIZ', 'MIDTERM', 'FINAL', 'PRACTICAL'].map((type) => ({
            value: type,
            label: type.charAt(0) + type.slice(1).toLowerCase(),
          }))}
          error={form.fieldErrors.type}
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
            {form.busy ? 'Creating…' : 'Create exam'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
