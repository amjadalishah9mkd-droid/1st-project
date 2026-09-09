'use client';

import { FormEvent, useState } from 'react';
import {
  createEventSchema,
  type EventItem,
  type SocietyItem,
} from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
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

export default function EventsPage() {
  const list = useList<EventItem>('/community/events');
  const { hasPermission } = useSession();
  const societies = useOptions<SocietyItem>('/community/societies');
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  // Real capability check: campus-wide permission OR officer of any society.
  const officerSocieties = societies.filter(
    (society) => society.myRole === 'OFFICER' || society.myRole === 'PRESIDENT',
  );
  const canCreateCampus = hasPermission('community.events.create');
  const canCreate = canCreateCampus || officerSocieties.length > 0;

  async function rsvp(event: EventItem, status: 'GOING' | 'INTERESTED' | 'DECLINED') {
    try {
      await apiFetch(`/community/events/${event.id}/rsvp`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      list.refetch();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'RSVP failed', 'error');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <input
          type="search"
          value={list.search}
          onChange={(event) => list.onSearchChange(event.target.value)}
          placeholder="Search events…"
          aria-label="Search events"
          className="h-9 w-64 rounded-lg border border-line-strong bg-surface-raised px-3 text-sm"
        />
        {canCreate ? (
          <Button onClick={() => setCreateOpen(true)}>Create event</Button>
        ) : null}
      </div>

      {list.loading ? (
        <Skeleton rows={4} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.refetch} />
      ) : list.rows.length === 0 ? (
        <div className="rounded-card border border-line bg-surface-raised shadow-card">
          <EmptyState title="No events" message="Campus and society events appear here." />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {list.rows.map((event) => (
            <div
              key={event.id}
              className="rounded-card border border-line bg-surface-raised p-5 shadow-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">
                    {event.title}{' '}
                    {event.status === 'CANCELLED' ? (
                      <Badge tone="danger">Cancelled</Badge>
                    ) : null}
                  </h3>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {new Date(event.startsAt).toLocaleString('en-GB', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    · {event.venue}
                    {event.societyName ? ` · ${event.societyName}` : ' · Campus-wide'}
                  </p>
                </div>
                <div className="text-right text-xs text-ink-muted">
                  <p>
                    {event.goingCount} going · {event.interestedCount} interested
                  </p>
                  {event.capacity ? <p>Capacity {event.capacity}</p> : null}
                </div>
              </div>
              <p className="mt-2 text-sm text-ink-secondary">{event.description}</p>
              {event.status === 'ACTIVE' ? (
                <div className="mt-3 flex gap-2">
                  {(['GOING', 'INTERESTED', 'DECLINED'] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      aria-pressed={event.myRsvp === status}
                      onClick={() => rsvp(event, status)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        event.myRsvp === status
                          ? 'border-brand-500 bg-brand-50 text-brand-800'
                          : 'border-line bg-surface text-ink-muted hover:text-ink'
                      }`}
                    >
                      {status === 'GOING'
                        ? 'Going'
                        : status === 'INTERESTED'
                          ? 'Interested'
                          : "Can't go"}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {canCreate ? (
        <CreateEventDialog
          open={createOpen}
          canCreateCampus={canCreateCampus}
          officerSocieties={officerSocieties}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            toast('Event created');
            list.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateEventDialog({
  open,
  canCreateCampus,
  officerSocieties,
  onClose,
  onSaved,
}: {
  open: boolean;
  canCreateCampus: boolean;
  officerSocieties: SocietyItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useZodForm(createEventSchema);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = formValues(event.currentTarget);
    for (const key of ['startsAt', 'endsAt']) {
      if (typeof raw[key] === 'string' && raw[key]) {
        raw[key] = new Date(raw[key] as string).toISOString();
      }
    }
    const input = form.validate(raw);
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch('/community/events', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    });
    if (done) onSaved();
  }

  const societyOptions = officerSocieties.map((society) => ({
    value: society.id,
    label: society.name,
  }));

  return (
    <Dialog open={open} title="Create event" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <Select
            label="Host"
            name="societyId"
            placeholder={canCreateCampus ? 'Campus-wide' : undefined}
            options={societyOptions}
            error={form.fieldErrors.societyId}
          />
        </div>
        <div className="sm:col-span-2">
          <Input label="Title" name="title" error={form.fieldErrors.title} />
        </div>
        <div className="sm:col-span-2">
          <Input label="Description" name="description" error={form.fieldErrors.description} />
        </div>
        <Input label="Venue" name="venue" error={form.fieldErrors.venue} />
        <Input label="Capacity (optional)" name="capacity" type="number" min={1} error={form.fieldErrors.capacity} />
        <Input label="Starts" name="startsAt" type="datetime-local" error={form.fieldErrors.startsAt} />
        <Input label="Ends" name="endsAt" type="datetime-local" error={form.fieldErrors.endsAt} />
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
            {form.busy ? 'Creating…' : 'Create event'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
