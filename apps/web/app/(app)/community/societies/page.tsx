'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createSocietySchema,
  type SocietyItem,
  type TeacherItem,
} from '@campusos/shared';
import { apiFetch } from '@/lib/api/client';
import { useList, useOptions } from '@/lib/hooks/use-list';
import { formValues, useZodForm } from '@/lib/hooks/use-zod-form';
import { useToast } from '@/components/providers/toast-provider';
import { useSession } from '@/components/providers/session-provider';
import { EmptyState, ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export default function SocietiesPage() {
  const list = useList<SocietyItem>('/community/societies');
  const { hasPermission } = useSession();
  const canManage = hasPermission('community.societies.manage');
  const teachers = useOptions<TeacherItem>('/teachers', canManage);
  const router = useRouter();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <input
          type="search"
          value={list.search}
          onChange={(event) => list.onSearchChange(event.target.value)}
          placeholder="Search societies…"
          aria-label="Search societies"
          className="h-9 w-64 rounded-lg border border-line-strong bg-surface-raised px-3 text-sm"
        />
        {canManage ? (
          <Button onClick={() => setCreateOpen(true)}>Charter society</Button>
        ) : null}
      </div>

      {list.loading ? (
        <Skeleton rows={4} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.refetch} />
      ) : list.rows.length === 0 ? (
        <div className="rounded-card border border-line bg-surface-raised shadow-card">
          <EmptyState
            title="No societies yet"
            message={canManage ? 'Charter the first society.' : 'Societies appear here once chartered.'}
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {list.rows.map((society) => (
            <button
              key={society.id}
              type="button"
              onClick={() => router.push(`/community/societies/${society.id}`)}
              className="flex flex-col gap-2 rounded-card border border-line bg-surface-raised p-5 text-left shadow-card transition-colors hover:border-brand-300"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold">{society.name}</span>
                <Badge tone="brand">
                  {society.category.charAt(0) + society.category.slice(1).toLowerCase()}
                </Badge>
              </div>
              <p className="line-clamp-2 text-sm text-ink-secondary">
                {society.description}
              </p>
              <p className="mt-auto text-xs text-ink-muted">
                {society.memberCount} members
                {society.facultyAdvisorName ? ` · Advisor: ${society.facultyAdvisorName}` : ''}
                {society.myRole
                  ? ` · You: ${society.myRole.charAt(0) + society.myRole.slice(1).toLowerCase()}`
                  : ''}
              </p>
            </button>
          ))}
        </div>
      )}

      {canManage ? (
        <CreateSocietyDialog
          open={createOpen}
          teachers={teachers}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            toast('Society chartered');
            list.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateSocietyDialog({
  open,
  teachers,
  onClose,
  onSaved,
}: {
  open: boolean;
  teachers: TeacherItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useZodForm(createSocietySchema);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = form.validate(formValues(event.currentTarget));
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch('/community/societies', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    });
    if (done) onSaved();
  }

  return (
    <Dialog open={open} title="Charter society" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input label="Name" name="name" error={form.fieldErrors.name} />
        <Select
          label="Category"
          name="category"
          options={['TECHNICAL', 'CULTURAL', 'SPORTS', 'LITERARY', 'SOCIAL', 'OTHER'].map(
            (category) => ({
              value: category,
              label: category.charAt(0) + category.slice(1).toLowerCase(),
            }),
          )}
          error={form.fieldErrors.category}
        />
        <Input label="Description" name="description" error={form.fieldErrors.description} />
        <Select
          label="Faculty advisor (optional)"
          name="facultyAdvisorId"
          placeholder="None"
          options={teachers.map((teacher) => ({
            value: teacher.id,
            label: `${teacher.firstName} ${teacher.lastName}`,
          }))}
          error={form.fieldErrors.facultyAdvisorId}
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
            {form.busy ? 'Chartering…' : 'Charter society'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
