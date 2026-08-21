'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { TimetableSlotItem } from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useSession } from '@/components/providers/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, Skeleton } from '@/components/data/data-table';

const DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
];

export default function TimetablePage() {
  const { user, hasPermission } = useSession();
  const [slots, setSlots] = useState<TimetableSlotItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = hasPermission('timetable.manage');

  const load = () => {
    setSlots(null);
    setError(null);
    apiFetch<TimetableSlotItem[]>('/timetable?view=me')
      .then((response) => setSlots(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      );
  };
  useEffect(load, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!slots) return <Skeleton rows={8} />;

  const visibleDays = DAYS.filter(
    (day) => day.value <= 5 || slots.some((slot) => slot.dayOfWeek === day.value),
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Timetable"
        description={
          canManage
            ? 'College-wide weekly schedule. Manage slots from each section page.'
            : user?.teacherProfile
              ? 'Your weekly teaching schedule.'
              : 'Your weekly class schedule.'
        }
      />

      {slots.length === 0 ? (
        <div className="rounded-card border border-line bg-surface-raised shadow-card">
          <EmptyState
            title="No timetable slots yet"
            message={
              canManage
                ? 'Add weekly slots from a section page (Timetable tab).'
                : 'Your sections have no scheduled slots yet.'
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {visibleDays.map((day) => {
            const daySlots = slots.filter((slot) => slot.dayOfWeek === day.value);
            return (
              <section
                key={day.value}
                className="rounded-card border border-line bg-surface-raised shadow-card"
              >
                <h2 className="border-b border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {day.label}
                </h2>
                {daySlots.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-ink-faint">
                    No classes
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {daySlots.map((slot) => (
                      <li key={slot.id} className="px-4 py-3">
                        <Link
                          href={`/sections/${slot.sectionId}`}
                          className="block"
                        >
                          <p className="font-mono text-xs text-ink-muted">
                            {slot.startTime} – {slot.endTime}
                          </p>
                          <p className="mt-0.5 text-sm font-medium text-ink hover:text-brand-700">
                            {slot.courseCode} — {slot.sectionName}
                          </p>
                          <p className="text-xs text-ink-muted">
                            {slot.room ? `${slot.room} · ` : ''}
                            {slot.teacherNames.join(', ') || 'No teacher yet'}
                          </p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
