'use client';

import { useEffect, useState } from 'react';
import type { ReportDetail, ReportItem } from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useList } from '@/lib/hooks/use-list';
import { useToast } from '@/components/providers/toast-provider';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';

const statusTones = {
  OPEN: 'danger',
  REVIEWING: 'warning',
  RESOLVED: 'success',
  DISMISSED: 'neutral',
} as const;

export default function ModerationPage() {
  const [statusFilter, setStatusFilter] = useState('OPEN');
  const list = useList<ReportItem>('/moderation/reports', {
    status: statusFilter || undefined,
  });
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const { toast } = useToast();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Moderation"
        description="Reported content queue — review, act, and keep the community healthy."
        actions={
          <Select
            label="Status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            placeholder="All statuses"
            options={['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED'].map((status) => ({
              value: status,
              label: status.charAt(0) + status.slice(1).toLowerCase(),
            }))}
          />
        }
      />

      <DataTable
        rowKey={(row) => row.id}
        rows={list.rows}
        meta={list.meta}
        loading={list.loading}
        error={list.error}
        onPageChange={list.setPage}
        onRetry={list.refetch}
        onRowClick={(row) => setActiveReportId(row.id)}
        emptyTitle="Queue is clear"
        emptyMessage="No reports match this filter."
        columns={[
          {
            key: 'target',
            header: 'Target',
            render: (row) => (
              <div>
                <p className="font-medium">
                  {row.targetType.charAt(0) + row.targetType.slice(1).toLowerCase()}
                </p>
                {row.reportCountForTarget > 1 ? (
                  <p className="text-xs text-danger-700">
                    {row.reportCountForTarget} reports on this target
                  </p>
                ) : null}
              </div>
            ),
          },
          {
            key: 'reason',
            header: 'Reason',
            render: (row) => (
              <div>
                <p>{row.reason.charAt(0) + row.reason.slice(1).toLowerCase()}</p>
                {row.details ? (
                  <p className="line-clamp-1 text-xs text-ink-muted">{row.details}</p>
                ) : null}
              </div>
            ),
          },
          { key: 'reporter', header: 'Reported by', render: (row) => row.reporterName },
          {
            key: 'when',
            header: 'When',
            render: (row) =>
              new Date(row.createdAt).toLocaleString('en-GB', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              }),
          },
          {
            key: 'status',
            header: 'Status',
            render: (row) => (
              <Badge tone={statusTones[row.status]}>{row.status}</Badge>
            ),
          },
        ]}
      />

      {activeReportId ? (
        <ReportDetailDialog
          reportId={activeReportId}
          onClose={() => setActiveReportId(null)}
          onActed={() => {
            setActiveReportId(null);
            toast('Moderation action recorded');
            list.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function ReportDetailDialog({
  reportId,
  onClose,
  onActed,
}: {
  reportId: string;
  onClose: () => void;
  onActed: () => void;
}) {
  const { toast } = useToast();
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [suspendDays, setSuspendDays] = useState('7');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ReportDetail>(`/moderation/reports/${reportId}`)
      .then((response) => setReport(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      );
  }, [reportId]);

  async function act(
    action:
      | 'REMOVE_CONTENT'
      | 'RESTORE_CONTENT'
      | 'WARN_USER'
      | 'SUSPEND_COMMUNITY'
      | 'LIFT_SUSPENSION',
  ) {
    if (!report) return;
    setBusy(action);
    try {
      await apiFetch('/moderation/actions', {
        method: 'POST',
        body: JSON.stringify({
          reportId: report.id,
          action,
          targetType: report.targetType,
          targetId: report.targetId,
          targetUserId: report.target?.authorUserId ?? undefined,
          note: note.trim() || undefined,
          ...(action === 'SUSPEND_COMMUNITY' && suspendDays
            ? { expiresInDays: Number(suspendDays) }
            : {}),
        }),
      });
      onActed();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Action failed', 'error');
      setBusy(null);
    }
  }

  async function dismiss() {
    if (!report) return;
    setBusy('DISMISS');
    try {
      await apiFetch(`/moderation/reports/${report.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'DISMISSED',
          resolutionNote: note.trim() || undefined,
        }),
      });
      onActed();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Dismiss failed', 'error');
      setBusy(null);
    }
  }

  const contentRemovable =
    report?.target && ['POST', 'COMMENT', 'EVENT', 'RESOURCE'].includes(report.target.kind);
  const contentRemoved =
    report?.target &&
    ['REMOVED_BY_MODERATOR', 'REMOVED'].includes(report.target.status);
  const open = report?.status === 'OPEN' || report?.status === 'REVIEWING';

  return (
    <Dialog
      open
      title="Report review"
      description={report ? `Filed by ${report.reporterName}` : undefined}
      onClose={onClose}
      wide
    >
      {error ? (
        <p className="text-sm text-danger-700">{error}</p>
      ) : !report ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-line bg-surface p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Reported {report.targetType.toLowerCase()} ·{' '}
              {report.reason.charAt(0) + report.reason.slice(1).toLowerCase()}
              {report.reportCountForTarget > 1
                ? ` · ${report.reportCountForTarget} reports on this target`
                : ''}
            </p>
            {report.details ? (
              <p className="mt-1 text-xs text-ink-muted">“{report.details}”</p>
            ) : null}
            {report.target ? (
              <div className="mt-3 border-t border-line pt-3">
                <p className="text-sm font-medium">{report.target.title}</p>
                {report.target.body ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-secondary">
                    {report.target.body}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-ink-muted">
                  By {report.target.authorName ?? 'unknown'} · status{' '}
                  {report.target.status}
                  {report.targetUserSuspended ? ' · author currently suspended' : ''}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">
                The target content no longer exists.
              </p>
            )}
          </div>

          {report.resolutionNote ? (
            <p className="text-xs text-ink-muted">
              Resolution: {report.resolutionNote}
              {report.resolvedByName ? ` — ${report.resolvedByName}` : ''}
            </p>
          ) : null}

          {open ? (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="mod-note" className="text-sm font-medium">
                  Note (sent to the affected user where applicable)
                </label>
                <textarea
                  id="mod-note"
                  rows={2}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  className="rounded-lg border border-line-strong bg-surface-raised px-3 py-2 text-sm"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={dismiss} disabled={busy !== null}>
                  {busy === 'DISMISS' ? '…' : 'Dismiss'}
                </Button>
                {contentRemovable && !contentRemoved ? (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => act('REMOVE_CONTENT')}
                    disabled={busy !== null}
                  >
                    {busy === 'REMOVE_CONTENT' ? '…' : 'Remove content'}
                  </Button>
                ) : null}
                {contentRemovable && contentRemoved ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => act('RESTORE_CONTENT')}
                    disabled={busy !== null}
                  >
                    {busy === 'RESTORE_CONTENT' ? '…' : 'Restore content'}
                  </Button>
                ) : null}
                {report.target?.authorUserId ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => act('WARN_USER')}
                      disabled={busy !== null}
                    >
                      {busy === 'WARN_USER' ? '…' : 'Warn author'}
                    </Button>
                    {report.targetUserSuspended ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => act('LIFT_SUSPENSION')}
                        disabled={busy !== null}
                      >
                        {busy === 'LIFT_SUSPENSION' ? '…' : 'Lift suspension'}
                      </Button>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => act('SUSPEND_COMMUNITY')}
                          disabled={busy !== null}
                        >
                          {busy === 'SUSPEND_COMMUNITY' ? '…' : 'Suspend author'}
                        </Button>
                        <input
                          type="number"
                          min={1}
                          max={365}
                          value={suspendDays}
                          onChange={(event) => setSuspendDays(event.target.value)}
                          aria-label="Suspension days"
                          className="h-8 w-16 rounded-lg border border-line-strong bg-surface-raised px-2 text-sm"
                        />
                        <span className="text-xs text-ink-muted">days</span>
                      </span>
                    )}
                  </>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
