'use client';

import { useState } from 'react';
import { useList } from '@/lib/hooks/use-list';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

interface AuditRow {
  id: string;
  action: string;
  createdAt: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  actor: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
  } | null;
}

/** Static action-prefix filter (decision B3 — no dynamic endpoint). */
const ACTION_PREFIXES = [
  { value: 'auth.', label: 'Authentication' },
  { value: 'verification.', label: 'Verification' },
  { value: 'settings.', label: 'Settings' },
  { value: 'preferences.', label: 'Preferences' },
  { value: 'mail.', label: 'Mail' },
  { value: 'exports.', label: 'Exports' },
  { value: 'moderation.', label: 'Moderation' },
  { value: 'students.', label: 'Students' },
];

function prefixTone(action: string): 'brand' | 'warning' | 'danger' | 'neutral' | 'success' {
  if (action.startsWith('auth.')) return 'brand';
  if (action.startsWith('verification.')) return 'warning';
  if (action.includes('fail') || action.includes('reject')) return 'danger';
  if (action.includes('approved') || action.includes('sent')) return 'success';
  return 'neutral';
}

/**
 * M12-W4 — read-only audit log viewer (audit.read). Tenancy, filtering and
 * authorization are enforced server-side; this page only renders.
 */
export default function AuditPage() {
  const [actionPrefix, setActionPrefix] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const list = useList<AuditRow>('/audit', {
    action: actionPrefix || undefined,
    from: from || undefined,
    to: to || undefined,
  });
  const [detail, setDetail] = useState<AuditRow | null>(null);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Audit log"
        description="Security-relevant activity in your college — read-only."
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Category"
              value={actionPrefix}
              onChange={(event) => setActionPrefix(event.target.value)}
              placeholder="All categories"
              options={ACTION_PREFIXES}
            />
            <Input
              label="From"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
            <Input
              label="To"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
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
        searchPlaceholder="Search action or target id…"
        onPageChange={list.setPage}
        onRetry={list.refetch}
        onRowClick={(row) => setDetail(row)}
        emptyTitle="No audit entries"
        emptyMessage="No activity matches this filter."
        columns={[
          {
            key: 'time',
            header: 'Time',
            render: (row) =>
              new Date(row.createdAt).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
          },
          {
            key: 'action',
            header: 'Action',
            render: (row) => (
              <Badge tone={prefixTone(row.action)}>{row.action}</Badge>
            ),
          },
          {
            key: 'actor',
            header: 'Actor',
            render: (row) =>
              row.actor ? (
                <div>
                  <p className="font-medium">
                    {row.actor.firstName} {row.actor.lastName}
                  </p>
                  <p className="text-xs text-ink-muted">{row.actor.email}</p>
                </div>
              ) : (
                <span className="text-ink-muted">System</span>
              ),
          },
          {
            key: 'target',
            header: 'Target',
            render: (row) =>
              row.targetType ? (
                <div>
                  <p>{row.targetType}</p>
                  <p className="max-w-40 truncate font-mono text-xs text-ink-muted">
                    {row.targetId}
                  </p>
                </div>
              ) : (
                '—'
              ),
          },
          {
            key: 'metadata',
            header: 'Details',
            render: (row) => {
              const text = JSON.stringify(row.metadata ?? {});
              return (
                <span className="block max-w-56 truncate font-mono text-xs text-ink-muted">
                  {text === '{}' ? '—' : text}
                </span>
              );
            },
          },
        ]}
      />

      {detail ? (
        <Dialog
          open
          title={detail.action}
          description={new Date(detail.createdAt).toLocaleString(undefined, {
            dateStyle: 'full',
            timeStyle: 'medium',
          })}
          onClose={() => setDetail(null)}
        >
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Actor</dt>
              <dd className="text-right">
                {detail.actor
                  ? `${detail.actor.firstName} ${detail.actor.lastName} (${detail.actor.email})`
                  : 'System'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Target</dt>
              <dd className="break-all text-right font-mono text-xs">
                {detail.targetType ? `${detail.targetType} · ${detail.targetId}` : '—'}
              </dd>
            </div>
            <div>
              <dt className="mb-1 text-ink-muted">Metadata</dt>
              <dd>
                <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-surface p-3 text-xs">
                  {JSON.stringify(detail.metadata ?? {}, null, 2)}
                </pre>
              </dd>
            </div>
          </dl>
        </Dialog>
      ) : null}
    </div>
  );
}
