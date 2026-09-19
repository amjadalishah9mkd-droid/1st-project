'use client';

import { useEffect, useState } from 'react';
import type { ClaimAdminItem, ClaimStatusKey } from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { openFile } from '@/lib/api/files';
import { useList } from '@/lib/hooks/use-list';
import { useToast } from '@/components/providers/toast-provider';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';

/**
 * M11-W6 — Admin Verification Center.
 * Pure consumer of the W3 verification API. The UI never authorizes
 * anything: PolicyService (verification.manage), tenancy and decision
 * guards all live server-side. Evidence is opened exclusively through the
 * authorized signing flow (openFile) — no signed URL ever touches the DOM.
 */
const STATUS_TONES: Record<ClaimStatusKey, 'warning' | 'success' | 'danger' | 'neutral'> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

function matchLabel(claim: ClaimAdminItem): {
  text: string;
  tone: 'success' | 'warning' | 'danger';
} {
  if (!claim.matchedProfile) {
    return { text: 'No matching record', tone: 'danger' };
  }
  return claim.matchedProfile.belongsToClaimant
    ? { text: 'Matches claimant', tone: 'success' }
    : { text: 'Belongs to another account', tone: 'warning' };
}

export default function VerificationPage() {
  const [statusFilter, setStatusFilter] = useState<string>('PENDING');
  const list = useList<ClaimAdminItem>('/verification/claims', {
    status: statusFilter || undefined,
  });
  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);
  const { toast } = useToast();

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Verification"
        description="Student identity claims — compare against records, review ID evidence, and decide."
        actions={
          <Select
            label="Status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            placeholder="All statuses"
            options={(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const).map(
              (status) => ({
                value: status,
                label: status.charAt(0) + status.slice(1).toLowerCase(),
              }),
            )}
          />
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
        searchPlaceholder="Search by admission number…"
        onPageChange={list.setPage}
        onRetry={list.refetch}
        onRowClick={(row) => setActiveClaimId(row.id)}
        emptyTitle="Queue is clear"
        emptyMessage="No identity claims match this filter."
        columns={[
          {
            key: 'claimant',
            header: 'Claimant',
            render: (row) => (
              <div>
                <p className="font-medium">
                  {row.claimant.firstName} {row.claimant.lastName}
                </p>
                <p className="text-xs text-ink-muted">{row.claimant.email}</p>
              </div>
            ),
          },
          {
            key: 'admissionNo',
            header: 'Claimed admission no',
            render: (row) => (
              <span className="font-mono text-sm">{row.claimedAdmissionNo}</span>
            ),
          },
          {
            key: 'match',
            header: 'Record match',
            render: (row) => {
              const match = matchLabel(row);
              return <Badge tone={match.tone}>{match.text}</Badge>;
            },
          },
          {
            key: 'submitted',
            header: 'Submitted',
            render: (row) =>
              new Date(row.createdAt).toLocaleDateString(undefined, {
                dateStyle: 'medium',
              }),
          },
          {
            key: 'status',
            header: 'Status',
            render: (row) => (
              <Badge tone={STATUS_TONES[row.status]}>{row.status}</Badge>
            ),
          },
        ]}
      />

      {activeClaimId ? (
        <ClaimDetailDialog
          claimId={activeClaimId}
          onClose={() => setActiveClaimId(null)}
          onDecided={(message) => {
            setActiveClaimId(null);
            toast(message);
            list.refetch();
          }}
          onConflict={(message) => {
            setActiveClaimId(null);
            toast(message, 'error');
            // Another admin may have decided meanwhile — resync the queue.
            list.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function ClaimDetailDialog({
  claimId,
  onClose,
  onDecided,
  onConflict,
}: {
  claimId: string;
  onClose: () => void;
  onDecided: (message: string) => void;
  onConflict: (message: string) => void;
}) {
  const { toast } = useToast();
  const [claim, setClaim] = useState<ClaimAdminItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'APPROVE' | 'REJECT' | null>(null);

  useEffect(() => {
    apiFetch<ClaimAdminItem>(`/verification/claims/${claimId}`)
      .then((response) => setClaim(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load claim'),
      );
  }, [claimId]);

  async function decide(decision: 'APPROVE' | 'REJECT') {
    if (!claim) return;
    if (decision === 'REJECT' && reason.trim().length < 3) {
      setReasonError('A rejection reason is required');
      return;
    }
    setReasonError(null);
    setBusy(decision);
    try {
      await apiFetch(`/verification/claims/${claim.id}/decision`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          ...(decision === 'REJECT' ? { rejectionReason: reason.trim() } : {}),
        }),
      });
      onDecided(
        decision === 'APPROVE'
          ? 'Claim approved — the student is now verified'
          : 'Claim rejected — the student has been notified',
      );
    } catch (err) {
      setBusy(null);
      if (err instanceof ApiError) {
        // Stale/conflicting state: the backend is authoritative.
        if (
          ['CLAIM_ALREADY_DECIDED', 'PROFILE_HAS_ACCOUNT', 'CLAIM_UNRESOLVED', 'NOT_FOUND'].includes(
            err.code,
          )
        ) {
          onConflict(err.message);
          return;
        }
        toast(err.message, 'error');
        return;
      }
      toast('Decision failed. Please try again.', 'error');
    }
  }

  const pending = claim?.status === 'PENDING';
  const approvable =
    pending && claim?.matchedProfile !== null && claim?.matchedProfile?.belongsToClaimant;

  return (
    <Dialog
      open
      title="Identity claim"
      description={
        claim
          ? `Submitted ${new Date(claim.createdAt).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}`
          : undefined
      }
      onClose={onClose}
      wide
    >
      {error ? (
        <p
          className="rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700"
          role="alert"
        >
          {error}
        </p>
      ) : !claim ? (
        <p className="text-sm text-ink-muted" role="status">
          Loading claim…
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-card border border-line bg-surface p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Claimant account
              </h3>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Name</dt>
                  <dd className="font-medium">
                    {claim.claimant.firstName} {claim.claimant.lastName}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Email</dt>
                  <dd className="break-all text-right">{claim.claimant.email}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Lifecycle</dt>
                  <dd>
                    <Badge tone="neutral">{claim.claimant.verificationStatus}</Badge>
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Claimed admission no</dt>
                  <dd className="font-mono">{claim.claimedAdmissionNo}</dd>
                </div>
              </dl>
            </section>

            <section className="rounded-card border border-line bg-surface p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Matched student record
              </h3>
              {claim.matchedProfile ? (
                <dl className="mt-3 space-y-1.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-muted">Name</dt>
                    <dd className="font-medium">
                      {claim.matchedProfile.firstName} {claim.matchedProfile.lastName}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-muted">Admission no</dt>
                    <dd className="font-mono">{claim.matchedProfile.admissionNo}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-muted">Roll no</dt>
                    <dd>{claim.matchedProfile.rollNo}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-muted">Batch</dt>
                    <dd>{claim.matchedProfile.batch}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-muted">Department</dt>
                    <dd className="text-right">{claim.matchedProfile.departmentName}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-muted">Ownership</dt>
                    <dd>
                      <Badge
                        tone={claim.matchedProfile.belongsToClaimant ? 'success' : 'warning'}
                      >
                        {claim.matchedProfile.belongsToClaimant
                          ? 'Belongs to claimant'
                          : 'Another account'}
                      </Badge>
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-3 rounded-lg border border-danger-500/30 bg-danger-50 p-3 text-sm text-danger-700">
                  No student record matches this admission number in your
                  college. Approval is not possible — reject the claim with
                  guidance.
                </p>
              )}
            </section>
          </div>

          <section className="flex items-center justify-between gap-4 rounded-card border border-line bg-surface p-4">
            {claim.evidence ? (
              <>
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium">{claim.evidence.name}</p>
                  <p className="text-xs text-ink-muted">
                    {claim.evidence.mimeType} · {(claim.evidence.size / 1024).toFixed(0)} KB —
                    ID-card evidence, access is audited
                  </p>
                </div>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void openFile(claim.evidence!.url).catch(() =>
                      toast('Could not open the evidence file', 'error'),
                    )
                  }
                >
                  View evidence
                </Button>
              </>
            ) : (
              <p className="text-sm text-ink-muted">No evidence on file.</p>
            )}
          </section>

          {claim.status !== 'PENDING' ? (
            <div className="rounded-card border border-line bg-surface p-4 text-sm">
              <div className="flex items-center gap-2">
                <Badge tone={STATUS_TONES[claim.status]}>{claim.status}</Badge>
                {claim.decidedAt ? (
                  <span className="text-ink-muted">
                    decided{' '}
                    {new Date(claim.decidedAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                ) : null}
              </div>
              {claim.rejectionReason ? (
                <p className="mt-2 text-ink-secondary">
                  Reason: {claim.rejectionReason}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {rejecting ? (
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium" htmlFor="rejection-reason">
                    Rejection reason (shown to the student)
                  </label>
                  <textarea
                    id="rejection-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={3}
                    className="rounded-lg border border-line-strong bg-surface p-3 text-sm"
                    placeholder="e.g. The admission number does not match any student record"
                  />
                  {reasonError ? (
                    <p className="text-sm text-danger-700" role="alert">
                      {reasonError}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-end gap-3">
                {!approvable ? (
                  <p className="mr-auto text-xs text-ink-muted">
                    {claim.matchedProfile
                      ? 'Approval is blocked: the record belongs to a different account.'
                      : 'Approval is blocked: no matching student record.'}
                  </p>
                ) : null}
                {rejecting ? (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => setRejecting(false)}
                      disabled={busy !== null}
                    >
                      Back
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => void decide('REJECT')}
                      disabled={busy !== null}
                    >
                      {busy === 'REJECT' ? 'Rejecting…' : 'Confirm rejection'}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => setRejecting(true)}
                      disabled={busy !== null}
                    >
                      Reject…
                    </Button>
                    <Button
                      onClick={() => void decide('APPROVE')}
                      disabled={!approvable || busy !== null}
                    >
                      {busy === 'APPROVE' ? 'Approving…' : 'Approve claim'}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
