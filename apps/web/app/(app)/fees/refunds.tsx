'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  PaymentRefundSummary,
  RefundAttemptItem,
} from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useSession } from '@/components/providers/session-provider';
import { useToast } from '@/components/providers/toast-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatAmount, formatDateTime } from '@/lib/format';

/**
 * M16-W4 — refund UI. The browser NEVER decides money truth: refundable
 * balances, invoice identity, provider references and state transitions
 * all come from the W2 backend. Buttons here are visibility HINTS gated
 * on resolved permissions (finance.refund); the API remains the
 * authorization boundary. All mutations are busy-guarded — the DB/CAS
 * idempotency from W2 is the real protection.
 */

export function refundTone(
  status: RefundAttemptItem['status'],
): 'neutral' | 'success' | 'warning' | 'danger' | 'brand' {
  switch (status) {
    case 'SUCCEEDED':
      return 'success';
    case 'PROCESSING':
      return 'brand';
    case 'FAILED':
      return 'danger';
    case 'CANCELLED':
      return 'neutral';
    default:
      return 'warning'; // REQUESTED
  }
}

/** Human message for the backend's refund error codes. */
function refundErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'The refund request failed';
  switch (err.code) {
    case 'EXCEEDS_REFUNDABLE':
      return `${err.message} — the balance may have changed; the view has been refreshed.`;
    case 'REFUND_IN_PROGRESS':
      return 'A refund for this payment is already in progress.';
    case 'CONFIRMATION_MISMATCH':
      return 'The typed confirmation must match the refund amount exactly.';
    case 'INVALID_TRANSITION':
      return 'This refund has already reached a final state.';
    case 'PROVIDER_UNAVAILABLE':
      return 'This payment was not settled by a gateway — record the refund instead.';
    case 'GATEWAY_ERROR':
      return 'The payment provider could not be reached. The refund may still be processing — use "Verify with provider".';
    default:
      return err.message;
  }
}

interface PaymentRow {
  id: string;
  amount: string;
  method: string;
  reference: string | null;
  paidAt: string;
}

// ── Invoice detail: refund history + refund action ────────────

export function InvoiceRefundsSection({
  payments,
  invoiceAmount,
  invoiceStatus,
  onChanged,
}: {
  payments: PaymentRow[];
  invoiceAmount: string;
  invoiceStatus: string;
  onChanged: () => void;
}) {
  const { hasPermission } = useSession();
  const canRefund = hasPermission('finance.refund');
  const [summaries, setSummaries] = useState<Map<string, PaymentRefundSummary>>(
    new Map(),
  );
  const [visible, setVisible] = useState(true);
  const [refunding, setRefunding] = useState<PaymentRow | null>(null);

  const load = useCallback(async () => {
    try {
      const results = await Promise.all(
        payments.map((payment) =>
          apiFetch<PaymentRefundSummary>(`/fees/payments/${payment.id}/refunds`),
        ),
      );
      setSummaries(new Map(results.map((r) => [r.data.paymentId, r.data])));
      setVisible(true);
    } catch {
      // e.g. guardian CHILD scope has no refund read projection yet —
      // hide the section instead of surfacing an error.
      setVisible(false);
    }
  }, [payments]);
  useEffect(() => {
    if (payments.length > 0) void load();
  }, [payments, load]);

  if (!visible || payments.length === 0) return null;
  const allAttempts = [...summaries.values()].flatMap((s) => s.attempts);
  const anyRefunds = [...summaries.values()].some(
    (s) => Number(s.refunded) > 0 || s.attempts.length > 0,
  );
  if (!anyRefunds && !canRefund) return null;

  return (
    <section className="mt-4 rounded-card border border-line bg-surface-raised shadow-card">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-sm font-semibold">Refunds</h2>
      </div>
      <ul className="divide-y divide-line text-sm">
        {payments.map((payment) => {
          const summary = summaries.get(payment.id);
          if (!summary) return null;
          return (
            <li key={payment.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    Payment {formatAmount(summary.paymentAmount)}{' '}
                    <span className="text-xs font-normal text-ink-muted">
                      · {payment.method.replace('_', ' ')} · {payment.paidAt}
                    </span>
                  </p>
                  <p className="text-xs text-ink-muted">
                    Refunded {formatAmount(summary.refunded)} · refundable{' '}
                    {formatAmount(summary.refundable)}
                  </p>
                </div>
                {canRefund && Number(summary.refundable) > 0 ? (
                  <Button
                    variant="secondary"
                    onClick={() => setRefunding(payment)}
                  >
                    Refund…
                  </Button>
                ) : null}
              </div>
              {summary.attempts.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {summary.attempts.map((attempt) => (
                    <li
                      key={attempt.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface px-3 py-1.5"
                    >
                      <div>
                        <span className="text-sm font-medium">
                          {formatAmount(attempt.amount)}
                        </span>{' '}
                        <span className="text-xs text-ink-muted">
                          · {attempt.method} · {formatDateTime(attempt.createdAt)} ·{' '}
                          {attempt.reason}
                          {attempt.providerRefundRef
                            ? ` · ${attempt.providerRefundRef.slice(0, 18)}…`
                            : ''}
                          {attempt.failureCode ? ` · ${attempt.failureCode}` : ''}
                        </span>
                      </div>
                      <Badge tone={refundTone(attempt.status)}>{attempt.status}</Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      {allAttempts.some((a) => a.status === 'PROCESSING') ? (
        <p className="border-t border-line px-5 py-2.5 text-xs text-ink-muted">
          A provider refund is processing — confirm it from Fees →
          Reconciliation → Refunds ("Verify with provider").
        </p>
      ) : null}
      {refunding ? (
        <RefundDialog
          payment={refunding}
          summary={summaries.get(refunding.id) ?? null}
          invoiceAmount={invoiceAmount}
          invoiceStatus={invoiceStatus}
          onClose={() => setRefunding(null)}
          onDone={() => {
            setRefunding(null);
            void load();
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

// ── Refund dialog: review → create → typed-confirmation execute ──

function RefundDialog({
  payment,
  summary,
  invoiceAmount,
  invoiceStatus,
  onClose,
  onDone,
}: {
  payment: PaymentRow;
  summary: PaymentRefundSummary | null;
  invoiceAmount: string;
  invoiceStatus: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const refundable = summary?.refundable ?? '0.00';
  const isOnline = payment.method === 'ONLINE';
  const [amount, setAmount] = useState(refundable);
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<'PROVIDER' | 'RECORDED'>(
    isOnline ? 'PROVIDER' : 'RECORDED',
  );
  const [busy, setBusy] = useState(false);
  // After creation the frozen attempt drives the typed confirmation.
  const [attempt, setAttempt] = useState<RefundAttemptItem | null>(null);
  const [confirm, setConfirm] = useState('');

  const frozen = attempt ? Number(attempt.amount).toFixed(2) : null;
  const confirmMatches = frozen !== null && confirm.trim() === frozen;

  async function create() {
    if (busy) return;
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      toast('Enter a refund amount greater than zero.', 'error');
      return;
    }
    if (reason.trim().length < 3) {
      toast('A reason is required.', 'error');
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetch<RefundAttemptItem>(
        `/fees/payments/${payment.id}/refunds`,
        {
          method: 'POST',
          body: JSON.stringify({
            amount: numeric,
            currency: 'PKR',
            reason: reason.trim(),
            method,
          }),
        },
      );
      setAttempt(response.data);
    } catch (err) {
      toast(refundErrorMessage(err), 'error');
      if (err instanceof ApiError && err.code === 'EXCEEDS_REFUNDABLE') onDone();
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (busy || !attempt || !confirmMatches) return;
    setBusy(true);
    try {
      const response = await apiFetch<RefundAttemptItem>(
        `/fees/refunds/${attempt.id}/execute`,
        { method: 'POST', body: JSON.stringify({ confirmAmount: confirm.trim() }) },
      );
      const result = response.data;
      if (result.status === 'SUCCEEDED') {
        toast(`Refund of ${formatAmount(result.amount)} completed.`);
      } else if (result.status === 'PROCESSING') {
        toast(
          'The provider has not confirmed this refund yet — verify it from Reconciliation → Refunds.',
          'error',
        );
      } else if (result.status === 'FAILED') {
        toast(
          `The provider refused this refund (${result.failureCode ?? 'FAILED'}). No money was returned.`,
          'error',
        );
      }
      onDone();
    } catch (err) {
      toast(refundErrorMessage(err), 'error');
      if (err instanceof ApiError && err.code === 'INVALID_TRANSITION') onDone();
    } finally {
      setBusy(false);
    }
  }

  async function cancelAttempt() {
    if (busy || !attempt) return;
    setBusy(true);
    try {
      await apiFetch(`/fees/refunds/${attempt.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      toast('Refund request cancelled.');
      onDone();
    } catch (err) {
      toast(refundErrorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title={attempt ? 'Confirm refund' : 'Refund payment'}
      description={
        attempt
          ? 'Type the exact refund amount to execute. The server independently verifies the confirmation and the refundable balance.'
          : 'Money is returned against this specific payment. The server recomputes the refundable balance at every step.'
      }
      onClose={() => (busy ? undefined : onClose())}
    >
      <div className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md bg-surface px-4 py-3 text-xs">
          <dt className="text-ink-muted">Payment</dt>
          <dd className="text-right font-medium">
            {formatAmount(payment.amount)} PKR
          </dd>
          <dt className="text-ink-muted">Method / date</dt>
          <dd className="text-right">
            {payment.method.replace('_', ' ')} · {payment.paidAt}
          </dd>
          {payment.reference ? (
            <>
              <dt className="text-ink-muted">Reference</dt>
              <dd className="truncate text-right font-mono">{payment.reference}</dd>
            </>
          ) : null}
          <dt className="text-ink-muted">Previously refunded</dt>
          <dd className="text-right">{formatAmount(summary?.refunded ?? '0.00')}</dd>
          <dt className="text-ink-muted">Remaining refundable</dt>
          <dd className="text-right font-semibold">
            {formatAmount(refundable)} PKR
          </dd>
          <dt className="text-ink-muted">Invoice</dt>
          <dd className="text-right">
            {formatAmount(invoiceAmount)} · {invoiceStatus}
          </dd>
        </dl>

        {!attempt ? (
          <>
            <Input
              label={`Refund amount (PKR, up to ${refundable})`}
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <Input
              label="Reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. duplicate payment"
            />
            {isOnline ? (
              <Select
                label="Refund method"
                value={method}
                onChange={(event) =>
                  setMethod(event.target.value as 'PROVIDER' | 'RECORDED')
                }
                options={[
                  { value: 'PROVIDER', label: 'Via payment provider (Safepay)' },
                  { value: 'RECORDED', label: 'Record an out-of-band refund' },
                ]}
              />
            ) : (
              <p className="text-xs text-ink-muted">
                This payment was settled manually — the refund is recorded as
                returned out of band (cash/bank).
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Close
              </Button>
              <Button onClick={create} disabled={busy}>
                {busy ? 'Creating…' : 'Continue'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Input
              label={`Type the refund amount to confirm: “${frozen}”`}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder={frozen ?? ''}
            />
            <div className="flex justify-between gap-2">
              <Button variant="secondary" onClick={cancelAttempt} disabled={busy}>
                Cancel request
              </Button>
              <Button onClick={execute} disabled={busy || !confirmMatches}>
                {busy ? 'Executing…' : `Refund ${frozen}`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ── Reconciliation → Refunds tab ───────────────────────────────

export function RefundsReconciliationView() {
  const { hasPermission } = useSession();
  const canRefund = hasPermission('finance.refund');
  const { toast } = useToast();
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<RefundAttemptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<RefundAttemptItem[]>(
      `/fees/refunds${status ? `?status=${status}` : ''}`,
    )
      .then((response) => setRows(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load refunds'),
      )
      .finally(() => setLoading(false));
  }, [status]);
  useEffect(load, [load]);

  // The browser only REQUESTS verification — provider truth decides.
  async function verify(attemptId: string) {
    if (acting) return;
    setActing(attemptId);
    try {
      const response = await apiFetch<RefundAttemptItem>(
        `/fees/refunds/${attemptId}/verify`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      const result = response.data;
      toast(
        result.status === 'SUCCEEDED'
          ? 'Refund confirmed by the provider.'
          : result.status === 'PROCESSING'
            ? 'The provider has not confirmed this refund yet.'
            : result.status === 'FAILED'
              ? `The provider reports this refund failed (${result.failureCode ?? 'FAILED'}).`
              : `Refund is ${result.status}.`,
        result.status === 'SUCCEEDED' ? undefined : 'error',
      );
      load();
    } catch (err) {
      toast(refundErrorMessage(err), 'error');
    } finally {
      setActing(null);
    }
  }

  async function cancel(attemptId: string) {
    if (acting) return;
    setActing(attemptId);
    try {
      await apiFetch(`/fees/refunds/${attemptId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      toast('Refund request cancelled.');
      load();
    } catch (err) {
      toast(refundErrorMessage(err), 'error');
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-xs">
        <Select
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'REQUESTED', label: 'Requested' },
            { value: 'PROCESSING', label: 'Processing' },
            { value: 'SUCCEEDED', label: 'Succeeded' },
            { value: 'FAILED', label: 'Failed' },
            { value: 'CANCELLED', label: 'Cancelled' },
          ]}
        />
      </div>
      {loading ? (
        <p className="py-8 text-center text-sm text-ink-muted">Loading refunds…</p>
      ) : error ? (
        <p className="py-8 text-center text-sm text-danger-600">{error}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-card border border-line bg-surface-raised px-5 py-10 text-center text-sm text-ink-muted">
          No refunds match this filter.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-surface-raised shadow-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-2.5">Invoice</th>
                <th className="px-4 py-2.5">Amount</th>
                <th className="px-4 py-2.5">Method</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Provider ref / failure</th>
                <th className="px-4 py-2.5">Created</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2.5 font-mono text-xs">{row.invoiceNo}</td>
                  <td className="px-4 py-2.5 font-medium">
                    {formatAmount(row.amount)}
                  </td>
                  <td className="px-4 py-2.5">{row.method}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={refundTone(row.status)}>{row.status}</Badge>
                  </td>
                  <td className="max-w-[220px] truncate px-4 py-2.5 font-mono text-xs text-ink-muted">
                    {row.providerRefundRef ?? row.failureCode ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-ink-muted">
                    {formatDateTime(row.createdAt)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {canRefund && row.status === 'PROCESSING' ? (
                      <Button
                        variant="secondary"
                        disabled={acting !== null}
                        onClick={() => verify(row.id)}
                      >
                        {acting === row.id ? 'Verifying…' : 'Verify with provider'}
                      </Button>
                    ) : canRefund && row.status === 'REQUESTED' ? (
                      <Button
                        variant="secondary"
                        disabled={acting !== null}
                        onClick={() => cancel(row.id)}
                      >
                        {acting === row.id ? 'Cancelling…' : 'Cancel'}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
