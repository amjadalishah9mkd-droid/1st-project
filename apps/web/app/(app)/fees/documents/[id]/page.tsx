'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { FinanceDocumentItem } from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatAmount, formatDateTime } from '@/lib/format';

/**
 * M20-W3 — finance document (receipt / refund document) print view.
 * Every value on this page comes from the FROZEN issuance snapshot served
 * by GET /fees/documents/:id — nothing is recomputed or re-read from live
 * invoices/payments/refunds, and the frontend performs no financial
 * arithmetic. Print follows the M12/M18 pattern (window.print + print CSS).
 * The backend re-authorizes every load (fees.read OWN/CHILD/ALL) — reaching
 * this URL (e.g. from a receipt email) is never authorization by itself.
 */
export default function FinanceDocumentPage() {
  const params = useParams<{ id: string }>();
  const [doc, setDoc] = useState<FinanceDocumentItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<FinanceDocumentItem>(`/fees/documents/${params.id}`)
      .then((response) => setDoc(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      )
      .finally(() => setLoading(false));
  }, [params.id]);
  useEffect(load, [load]);

  if (loading) return <Skeleton rows={8} />;
  if (error || !doc)
    return <ErrorState message={error ?? 'Not found'} onRetry={load} />;

  const isReceipt = doc.kind === 'PAYMENT_RECEIPT';
  const isVoid = doc.status === 'VOID';
  const title = isReceipt ? 'Payment Receipt' : 'Refund Document';

  return (
    <div className="mx-auto max-w-2xl">
      <div className="print-hide mb-6 flex items-center justify-between">
        <p className="text-sm text-ink-muted">
          Issued document — values are frozen at issuance. Use Print / Save
          as PDF for an official copy.
        </p>
        <Button onClick={() => window.print()}>Print / Save as PDF</Button>
      </div>

      <div className="relative rounded-card border border-line bg-white p-8 text-ink shadow-card print:border-0 print:shadow-none">
        {isVoid ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <span className="-rotate-12 select-none text-7xl font-black tracking-widest text-red-200">
              VOID
            </span>
          </div>
        ) : null}

        <header className="border-b-2 border-ink pb-4 text-center">
          <h1 className="text-2xl font-bold tracking-tight">{doc.collegeName}</h1>
          <p className="text-sm text-ink-muted">
            {doc.collegeCode} · {title}
          </p>
        </header>

        <div className="mt-4 flex items-center justify-between">
          <p className="font-mono text-lg font-semibold">{doc.receiptNo}</p>
          <Badge tone={isVoid ? 'danger' : 'success'}>{doc.status}</Badge>
        </div>

        {isVoid ? (
          <p className="mt-1 text-sm text-red-700">
            Voided {doc.voidedAt ? formatDateTime(doc.voidedAt) : ''}
            {doc.voidReason ? ` — ${doc.voidReason}` : ''}. This document is
            retained for the historical record and is no longer valid.
          </p>
        ) : null}

        <section className="mt-6 grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
          {(
            [
              ['Student', doc.studentName],
              ['Admission no', doc.admissionNo],
              ['Roll no', doc.rollNo],
              ['Invoice', doc.invoiceNo],
              ['Fee', doc.structureName],
              [
                isReceipt ? 'Paid at' : 'Refunded at',
                formatDateTime(doc.paidAt),
              ],
              ['Method', doc.method],
              ['Reference', doc.referenceMasked ?? '—'],
              ...(doc.parentReceiptNo
                ? ([['Original receipt', doc.parentReceiptNo]] as const)
                : []),
              ...(doc.receivedByName
                ? ([
                    [
                      isReceipt ? 'Received by' : 'Recorded by',
                      doc.receivedByName,
                    ],
                  ] as const)
                : []),
            ] as ReadonlyArray<readonly [string, string]>
          ).map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-line/60 py-1">
              <span className="text-ink-muted">{label}</span>
              <span className="text-right font-medium">{value}</span>
            </div>
          ))}
        </section>

        <section className="mt-8 rounded border border-line bg-surface p-4 print:border-ink">
          <div className="flex items-baseline justify-between">
            <span className="text-sm uppercase tracking-wide text-ink-muted">
              {isReceipt ? 'Amount received' : 'Amount refunded'}
            </span>
            <span className="text-3xl font-bold tracking-tight">
              {formatAmount(doc.amount)}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-8 text-sm text-ink-muted">
            <div className="flex justify-between">
              <span>Invoice total</span>
              <span>{formatAmount(doc.invoiceAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span>Balance at issuance</span>
              <span>{formatAmount(doc.balanceAfter)}</span>
            </div>
          </div>
        </section>

        <footer className="mt-8 border-t border-line pt-4 text-xs text-ink-muted">
          Issued {formatDateTime(doc.issuedAt)} · {doc.collegeName} · This
          document reflects the transaction exactly as recorded at issuance;
          later activity never alters it.
        </footer>
      </div>
    </div>
  );
}
