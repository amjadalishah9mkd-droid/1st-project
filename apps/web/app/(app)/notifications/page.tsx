'use client';

import type { NotificationItem } from '@campusos/shared';
import Link from 'next/link';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useList } from '@/lib/hooks/use-list';
import { useToast } from '@/components/providers/toast-provider';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, Skeleton } from '@/components/data/data-table';
import { Button } from '@/components/ui/button';

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function NotificationsPage() {
  const list = useList<NotificationItem>('/notifications');
  const { toast } = useToast();

  async function markRead(id: string) {
    try {
      await apiFetch(`/notifications/${id}/read`, { method: 'PATCH' });
      list.refetch();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed', 'error');
    }
  }

  async function markAll() {
    try {
      const response = await apiFetch<{ read: number }>('/notifications/read-all', {
        method: 'POST',
      });
      toast(`${response.data.read} notification(s) marked as read`);
      list.refetch();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed', 'error');
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        description="Everything that needs your attention, newest first."
        actions={
          <Button variant="secondary" onClick={markAll}>
            Mark all as read
          </Button>
        }
      />

      {list.loading ? (
        <Skeleton rows={6} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.refetch} />
      ) : list.rows.length === 0 ? (
        <div className="rounded-card border border-line bg-surface-raised shadow-card">
          <EmptyState
            title="All caught up"
            message="Notifications about attendance, assignments, results, fees and the community appear here."
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.rows.map((notification) => (
            <li
              key={notification.id}
              className={`flex items-start justify-between gap-3 rounded-card border p-4 shadow-card ${
                notification.readAt
                  ? 'border-line bg-surface-raised'
                  : 'border-brand-200 bg-brand-50/40'
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {notification.title}
                  {!notification.readAt ? (
                    <span className="ml-2 inline-block h-2 w-2 rounded-full bg-brand-500" aria-label="Unread" />
                  ) : null}
                </p>
                <p className="mt-0.5 text-sm text-ink-secondary">{notification.body}</p>
                <p className="mt-1 text-xs text-ink-faint">{timeAgo(notification.createdAt)}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {notification.linkPath ? (
                  <Link
                    href={notification.linkPath}
                    onClick={() => {
                      if (!notification.readAt) void markRead(notification.id);
                    }}
                    className="text-xs font-medium text-brand-700 hover:underline"
                  >
                    Open
                  </Link>
                ) : null}
                {!notification.readAt ? (
                  <button
                    type="button"
                    onClick={() => markRead(notification.id)}
                    className="text-xs text-ink-muted hover:text-ink"
                  >
                    Mark read
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {list.meta && list.meta.page < list.meta.totalPages ? (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={() => list.setPage(list.meta!.page + 1)}>
            Older
          </Button>
        </div>
      ) : null}
    </div>
  );
}
