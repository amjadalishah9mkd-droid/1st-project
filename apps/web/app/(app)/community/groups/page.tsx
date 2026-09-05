'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createGroupSchema, type GroupItem } from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useList } from '@/lib/hooks/use-list';
import { formValues, useZodForm } from '@/lib/hooks/use-zod-form';
import { useToast } from '@/components/providers/toast-provider';
import { EmptyState, ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export default function GroupsPage() {
  const list = useList<GroupItem>('/community/groups');
  const router = useRouter();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  async function join(group: GroupItem) {
    try {
      await apiFetch(`/community/groups/${group.id}/membership`, {
        method: 'POST',
      });
      toast(
        group.privacy === 'OPEN'
          ? `Joined ${group.name}`
          : 'Join request sent — a moderator will approve it',
        'info',
      );
      list.refetch();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Join failed', 'error');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <input
          type="search"
          value={list.search}
          onChange={(event) => list.onSearchChange(event.target.value)}
          placeholder="Search groups…"
          aria-label="Search groups"
          className="h-9 w-64 rounded-lg border border-line-strong bg-surface-raised px-3 text-sm"
        />
        <Button onClick={() => setCreateOpen(true)}>Create group</Button>
      </div>

      {list.loading ? (
        <Skeleton rows={4} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.refetch} />
      ) : list.rows.length === 0 ? (
        <div className="rounded-card border border-line bg-surface-raised shadow-card">
          <EmptyState title="No groups yet" message="Create the first interest group." />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {list.rows.map((group) => (
            <div
              key={group.id}
              className="flex flex-col gap-3 rounded-card border border-line bg-surface-raised p-5 shadow-card"
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => router.push(`/community/groups/${group.id}`)}
                  className="text-left text-sm font-semibold text-ink hover:text-brand-700"
                >
                  {group.name}
                </button>
                <Badge tone={group.privacy === 'OPEN' ? 'success' : 'warning'}>
                  {group.privacy === 'OPEN' ? 'Open' : 'By request'}
                </Badge>
              </div>
              <p className="line-clamp-2 text-sm text-ink-secondary">{group.description}</p>
              <div className="mt-auto flex items-center justify-between">
                <span className="text-xs text-ink-muted">
                  {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
                </span>
                {group.myMembership ? (
                  <Badge tone={group.myMembership.status === 'ACTIVE' ? 'brand' : 'neutral'}>
                    {group.myMembership.status === 'PENDING'
                      ? 'Requested'
                      : group.myMembership.role === 'MODERATOR'
                        ? 'Moderator'
                        : 'Member'}
                  </Badge>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => join(group)}>
                    {group.privacy === 'OPEN' ? 'Join' : 'Request to join'}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateGroupDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          toast('Group created — you are its moderator');
          list.refetch();
        }}
      />
    </div>
  );
}

function CreateGroupDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useZodForm(createGroupSchema);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = form.validate(formValues(event.currentTarget));
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch('/community/groups', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    });
    if (done) onSaved();
  }

  return (
    <Dialog open={open} title="Create group" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input label="Name" name="name" error={form.fieldErrors.name} />
        <Input label="Description" name="description" error={form.fieldErrors.description} />
        <Select
          label="Privacy"
          name="privacy"
          options={[
            { value: 'OPEN', label: 'Open — anyone can join' },
            { value: 'REQUEST', label: 'By request — moderators approve' },
          ]}
          error={form.fieldErrors.privacy}
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
            {form.busy ? 'Creating…' : 'Create group'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
