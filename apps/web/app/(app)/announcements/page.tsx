'use client';

import { FormEvent, useState } from 'react';
import {
  createAnnouncementSchema,
  type AnnouncementItem,
  type DepartmentItem,
  type SectionItem,
} from '@campusos/shared';
import { apiFetch } from '@/lib/api/client';
import { useList, useOptions } from '@/lib/hooks/use-list';
import { useZodForm } from '@/lib/hooks/use-zod-form';
import { useToast } from '@/components/providers/toast-provider';
import { useSession } from '@/components/providers/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export default function AnnouncementsPage() {
  const list = useList<AnnouncementItem>('/announcements');
  const { user, hasPermission } = useSession();
  const canCreate = hasPermission('announcements.create');
  const isAdminScope = hasPermission('settings.manage'); // ALL-scope authors
  const { toast } = useToast();
  const [composeOpen, setComposeOpen] = useState(false);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Announcements"
        description="Official updates addressed to you."
        actions={
          canCreate ? (
            <Button onClick={() => setComposeOpen(true)}>New announcement</Button>
          ) : undefined
        }
      />

      {list.loading ? (
        <Skeleton rows={5} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.refetch} />
      ) : list.rows.length === 0 ? (
        <div className="rounded-card border border-line bg-surface-raised shadow-card">
          <EmptyState
            title="No announcements"
            message="Announcements addressed to you will appear here."
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.rows.map((announcement) => (
            <li
              key={announcement.id}
              className="rounded-card border border-line bg-surface-raised p-5 shadow-card"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-sm font-semibold">{announcement.title}</h2>
                <Badge tone="brand">
                  {announcement.audienceLabels.join(', ') || announcement.audienceScope}
                </Badge>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink-secondary">
                {announcement.body}
              </p>
              <p className="mt-3 text-xs text-ink-muted">
                {announcement.authorName} ·{' '}
                {announcement.publishedAt
                  ? new Date(announcement.publishedAt).toLocaleString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : ''}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canCreate ? (
        <ComposeDialog
          open={composeOpen}
          isAdminScope={isAdminScope}
          isTeacher={user?.teacherProfile !== null}
          onClose={() => setComposeOpen(false)}
          onSaved={() => {
            setComposeOpen(false);
            toast('Announcement published');
            list.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function ComposeDialog({
  open,
  isAdminScope,
  isTeacher,
  onClose,
  onSaved,
}: {
  open: boolean;
  isAdminScope: boolean;
  isTeacher: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useZodForm(createAnnouncementSchema);
  // Teachers announce only to their sections (ASSIGNED scope, server-enforced).
  const [scope, setScope] = useState(isAdminScope ? 'ALL' : 'SECTION');
  const [targetId, setTargetId] = useState('');
  const departments = useOptions<DepartmentItem>('/departments', open && isAdminScope);
  const sections = useOptions<SectionItem>(
    isTeacher && !isAdminScope ? '/sections?mine=true' : '/sections',
    open,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = form.validate({
      title: data.get('title'),
      body: data.get('body'),
      audienceScope: scope,
      audienceIds: scope === 'ALL' ? [] : targetId ? [targetId] : [],
    });
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch('/announcements', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    });
    if (done) onSaved();
  }

  const scopeOptions = isAdminScope
    ? [
        { value: 'ALL', label: 'Everyone' },
        { value: 'ROLE', label: 'A role' },
        { value: 'DEPARTMENT', label: 'A department' },
        { value: 'SECTION', label: 'A section' },
      ]
    : [{ value: 'SECTION', label: 'One of my sections' }];

  return (
    <Dialog
      open={open}
      title="New announcement"
      description="Recipients are notified immediately."
      onClose={onClose}
      wide
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input label="Title" name="title" error={form.fieldErrors.title} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ann-body" className="text-sm font-medium">
            Message
          </label>
          <textarea
            id="ann-body"
            name="body"
            rows={4}
            className={`rounded-lg border bg-surface-raised px-3 py-2 text-sm ${
              form.fieldErrors.body ? 'border-danger-500' : 'border-line-strong'
            }`}
          />
          {form.fieldErrors.body ? (
            <p className="text-xs text-danger-700">{form.fieldErrors.body}</p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Audience"
            value={scope}
            onChange={(event) => {
              setScope(event.target.value);
              setTargetId('');
            }}
            options={scopeOptions}
          />
          {scope === 'ROLE' ? (
            <Select
              label="Role"
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              placeholder="Select role"
              options={['STUDENT', 'TEACHER', 'ADMIN'].map((role) => ({
                value: role,
                label: role.charAt(0) + role.slice(1).toLowerCase(),
              }))}
            />
          ) : scope === 'DEPARTMENT' ? (
            <Select
              label="Department"
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              placeholder="Select department"
              options={departments.map((department) => ({
                value: department.id,
                label: `${department.code} — ${department.name}`,
              }))}
            />
          ) : scope === 'SECTION' ? (
            <Select
              label="Section"
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              placeholder="Select section"
              options={sections.map((section) => ({
                value: section.id,
                label: `${section.courseCode} — Section ${section.name}`,
              }))}
            />
          ) : (
            <div />
          )}
        </div>
        {form.fieldErrors.audienceIds ? (
          <p className="text-xs text-danger-700">{form.fieldErrors.audienceIds}</p>
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
            {form.busy ? 'Publishing…' : 'Publish'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
