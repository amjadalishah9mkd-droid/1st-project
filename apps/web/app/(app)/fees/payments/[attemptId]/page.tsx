'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { InvoiceDetail } from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { formatAmount } from '@/lib/format';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * M14-W4 — payment attempt status page (/fees/payments/[attemptId]).
 *
 * The browser NEVER tells CampusOS a payment succeeded: this page only
 * calls POST /payments/attempts/:id/verify (no body — query parameters
 * from the gateway redirect are deliberately ignored) and renders
 * whatever the server, after asking the provider, says the attempt is.
 * PENDING polls at 4s for up to 2 minutes, then offers a manual refresh.
 */

interface AttemptStatus {
  attemptId: string;
  invoiceId: string;
  status:
    | 'CREATED'
    | 'PENDING'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'EXPIRED'
    | 'CANCELLED'
    | 'REFUNDED';
  amount: string;
  currency: string;
}

const POLL_INTERVAL_MS = 4_000;
const MAX_POLL_MS = 2 * 60_000;
const TERMINAL: AttemptStatus['status'][] = [
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
  'REFUNDED',
];

export default function PaymentStatusPage() {
  const params = useParams<{ attemptId: string }>();
  const [attempt, setAttempt] = useState<AttemptStatus | null>(null);
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const startedAt = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const verify = useCallback(async (): Promise<AttemptStatus | null> => {
    try {
      const response = await apiFetch<AttemptStatus>(
        `/payments/attempts/${params.attemptId}/verify`,
        { method: 'POST' },
      );
      setAttempt(response.data);
      setError(null);
      return response.data;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed');
      return null;
    }
  }, [params.attemptId]);

  // Verify on arrival, then poll while PENDING (bounded).
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      const current = await verify();
      if (cancelled || !current) return;
      if (TERMINAL.includes(current.status)) return; // stop immediately
      if (Date.now() - startedAt.current >= MAX_POLL_MS) {
        setTimedOut(true);
        return;
      }
      timer.current = setTimeout(tick, POLL_INTERVAL_MS);
    }
    tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [verify]);

  // Load the invoice for context (number/balance) once we know it.
  useEffect(() => {
    if (!attempt?.invoiceId) return;
    apiFetch<InvoiceDetail>(`/fees/invoices/${attempt.invoiceId}`)
      .then((response) => setInvoice(response.data))
      .catch(() => undefined); // context only — the attempt view stands alone
  }, [attempt?.invoiceId, attempt?.status]);

  if (error && !attempt) {
    return <ErrorState message={error} onRetry={() => verify()} />;
  }
  if (!attempt) return <Skeleton rows={6} />;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Payment status"
        description={
          invoice
            ? `Invoice ${invoice.invoiceNo} · ${invoice.structureName}`
            : 'Online fee payment'
        }
      />
      <section className="rounded-card border border-line bg-surface-raised p-6 shadow-card">
        {attempt.status === 'SUCCEEDED' ? (
          <StatusBlock
            tone="success"
            badge="SUCCEEDED"
            title="Payment successful"
            message={`Your payment of ${formatAmount(attempt.amount)} ${
              invoice ? `for invoice ${invoice.invoiceNo} ` : ''
            }was received.${
              invoice ? ` The invoice is now ${invoice.status}.` : ''
            }`}
          />
        ) : attempt.status === 'FAILED' ? (
          <StatusBlock
            tone="danger"
            badge="FAILED"
            title="Payment failed"
            message={`The payment of ${formatAmount(attempt.amount)} could not be completed. No money was recorded${
              invoice ? ` — the invoice balance is still ${formatAmount(invoice.balance)}` : ''
            }.`}
          />
        ) : attempt.status === 'EXPIRED' || attempt.status === 'CANCELLED' ? (
          <StatusBlock
            tone="neutral"
            badge={attempt.status}
            title="This payment attempt is no longer active."
            message="Nothing was charged. If your invoice still has an outstanding balance you can start a new payment from the invoice page."
          />
        ) : timedOut ? (
          <StatusBlock
            tone="brand"
            badge="PENDING"
            title="Payment is still awaiting confirmation."
            message="Your bank or payment provider has not confirmed the payment yet. This can take a few minutes — nothing is lost. You can check again below."
          />
        ) : (
          <StatusBlock
            tone="brand"
            badge="PENDING"
            title="Payment pending confirmation…"
            message={`We are confirming your payment of ${formatAmount(attempt.amount)} with the payment provider. This page updates automatically.`}
            spinner
          />
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          {timedOut && !TERMINAL.includes(attempt.status) ? (
            <Button
              onClick={() => {
                startedAt.current = Date.now();
                setTimedOut(false);
                verify();
              }}
            >
              Check again
            </Button>
          ) : null}
          {(attempt.status === 'FAILED' ||
            attempt.status === 'EXPIRED' ||
            attempt.status === 'CANCELLED') &&
          invoice &&
          Number(invoice.balance) > 0 &&
          invoice.status !== 'CANCELLED' ? (
            <PayAgainButton invoiceId={attempt.invoiceId} />
          ) : null}
          <Link href={`/fees/invoices/${attempt.invoiceId}`}>
            <Button variant="secondary">View invoice</Button>
          </Link>
          <Link href="/fees">
            <Button variant="secondary">Back to fees</Button>
          </Link>
        </div>
        {error ? (
          <p className="mt-4 text-xs text-danger-700" role="alert">
            Last status check failed: {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function StatusBlock({
  tone,
  badge,
  title,
  message,
  spinner,
}: {
  tone: 'success' | 'danger' | 'neutral' | 'brand';
  badge: string;
  title: string;
  message: string;
  spinner?: boolean;
}) {
  return (
    <div role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        {spinner ? (
          <div
            className="h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-brand-600"
            aria-hidden
          />
        ) : null}
        <Badge tone={tone}>{badge}</Badge>
      </div>
      <h2 className="mt-3 text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-ink-secondary">{message}</p>
    </div>
  );
}

/** Starts a NEW attempt through the normal endpoint — never resurrects. */
function PayAgainButton({ invoiceId }: { invoiceId: string }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <>
      <Button
        disabled={busy}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          setFailure(null);
          try {
            const response = await apiFetch<{ checkoutUrl: string }>(
              `/fees/invoices/${invoiceId}/pay`,
              { method: 'POST' },
            );
            window.location.href = response.data.checkoutUrl;
          } catch (err) {
            setBusy(false);
            setFailure(
              err instanceof ApiError && err.code === 'FEATURE_DISABLED'
                ? 'Online payments are not enabled for your college yet.'
                : 'The payment could not be started. Please try again.',
            );
          }
        }}
      >
        {busy ? 'Starting payment…' : 'Try again'}
      </Button>
      {failure ? (
        <p className="w-full text-xs text-danger-700" role="alert">
          {failure}
        </p>
      ) : null}
    </>
  );
}
