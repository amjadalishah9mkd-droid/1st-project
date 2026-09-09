'use client';

import type { PageMeta } from '@campusos/shared';
import { Button } from '@/components/ui/button';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 p-4" aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-10 animate-pulse rounded-lg bg-surface-sunken"
        />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-sm text-sm text-ink-muted">{message}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center" role="alert">
      <p className="text-sm font-semibold text-danger-700">Something went wrong</p>
      <p className="max-w-sm text-sm text-ink-muted">{message}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/**
 * DataTable — the single list surface (Blueprint §6 reusable components):
 * toolbar (search + actions), column config, loading skeleton, empty,
 * error and pagination states.
 */
export function DataTable<T>({
  columns,
  rows,
  meta,
  loading,
  error,
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  onPageChange,
  onRetry,
  onRowClick,
  emptyTitle = 'Nothing here yet',
  emptyMessage = 'No records match your filters.',
  toolbarActions,
  rowKey,
}: {
  columns: Array<Column<T>>;
  rows: T[];
  meta: PageMeta | null;
  loading: boolean;
  error: string | null;
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  onPageChange?: (page: number) => void;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyMessage?: string;
  toolbarActions?: React.ReactNode;
  rowKey: (row: T) => string;
}) {
  return (
    <div className="rounded-card border border-line bg-surface-raised shadow-card">
      {(onSearchChange || toolbarActions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          {onSearchChange ? (
            <input
              type="search"
              value={search ?? ''}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-9 w-64 max-w-full rounded-lg border border-line-strong bg-surface px-3 text-sm placeholder:text-ink-faint focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-brand-500"
            />
          ) : (
            <div />
          )}
          {toolbarActions ? (
            <div className="flex items-center gap-2">{toolbarActions}</div>
          ) : null}
        </div>
      )}

      {loading ? (
        <Skeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : rows.length === 0 ? (
        <EmptyState title={emptyTitle} message={emptyMessage} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted ${column.className ?? ''}`}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`border-b border-line last:border-b-0 ${
                    onRowClick
                      ? 'cursor-pointer transition-colors hover:bg-surface'
                      : ''
                  }`}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-4 py-3 ${column.className ?? ''}`}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta && meta.totalPages > 1 && !loading && !error ? (
        <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-ink-secondary">
          <span>
            Page {meta.page} of {meta.totalPages} · {meta.total} total
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => onPageChange?.(meta.page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={meta.page >= meta.totalPages}
              onClick={() => onPageChange?.(meta.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
