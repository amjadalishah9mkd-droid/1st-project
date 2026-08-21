'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  recordPaymentSchema,
  type InvoiceDetail,
} from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { formValues, useZodForm } from '@/lib/hooks/use-zod-form';
import { useSession } from '@/components/providers/session-provider';
import { useToast } from '@/components/providers/toast-provider';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState, Skeleton } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { invoiceTone } from '../../fee-utils';
import { formatAmount } from '@/lib/format';

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const { hasPermission } = useSession();
  const canManage = hasPermission('fees.manage');
  const { toast } = useToast();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<InvoiceDetail>(`/fees/invoices/${params.id}`)
      .then((response) => setInvoice(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load'),
      )
      .finally(() => setLoading(false));
  }, [params.id]);
  useEffect(load, [load]);

  if (loading) return <Skeleton rows={8} />;
  if (error || !invoice)
    return <ErrorState message={error ?? 'Not found'} onRetry={load} />;

  const open = invoice.status !== 'PAID' && invoice.status !== 'CANCELLED';

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={invoice.invoiceNo}
        description={`${invoice.structureName} · ${invoice.studentName} (${invoice.rollNo})`}
        actions={
          canManage && open ? (
            <>
              {invoice.payments.length === 0 ? (
                <Button variant="secondary" onClick={() => setCancelConfirm(true)}>
                  Cancel invoice
                </Button>
              ) : null}
              <Button onClick={() => setPaymentOpen(true)}>Record payment</Button>
            </>
          ) : undefined
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Status', <Badge key="s" tone={invoiceTone(invoice.status)}>{invoice.status}</Badge>],
          ['Amount', formatAmount(invoice.amount)],
          ['Paid', formatAmount(invoice.paidAmount)],
          ['Balance', formatAmount(invoice.balance)],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-card border border-line bg-surface-raised p-4 shadow-card">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {label as string}
            </p>
            <p className="mt-1 text-sm font-semibold">{value as React.ReactNode}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-card border border-line bg-surface-raised shadow-card">
          <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">
            Fee breakdown
          </h2>
          <ul className="divide-y divide-line text-sm">
            {invoice.components.map((component) => (
              <li key={component.label} className="flex justify-between px-5 py-2.5">
                <span>{component.label}</span>
                <span className="font-medium">{formatAmount(component.amount)}</span>
              </li>
            ))}
            <li className="flex justify-between px-5 py-2.5 font-semibold">
              <span>Total</span>
              <span>{formatAmount(invoice.amount)}</span>
            </li>
          </ul>
          <p className="border-t border-line px-5 py-2.5 text-xs text-ink-muted">
            Due {invoice.dueDate}
          </p>
        </section>

        <section className="rounded-card border border-line bg-surface-raised shadow-card">
          <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">
            Payments ({invoice.payments.length})
          </h2>
          {invoice.payments.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-muted">
              No payments recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {invoice.payments.map((payment) => (
                <li key={payment.id} className="px-5 py-2.5">
                  <div className="flex justify-between">
                    <span className="font-medium">{formatAmount(payment.amount)}</span>
                    <span className="text-ink-muted">{payment.paidAt}</span>
                  </div>
                  <p className="text-xs text-ink-muted">
                    {payment.method.replace('_', ' ')}
                    {payment.reference ? ` · ref ${payment.reference}` : ''} · by{' '}
                    {payment.recordedByName}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {canManage ? (
        <>
          <PaymentDialog
            open={paymentOpen}
            balance={invoice.balance}
            invoiceId={invoice.id}
            onClose={() => setPaymentOpen(false)}
            onDone={() => {
              setPaymentOpen(false);
              toast('Payment recorded');
              load();
            }}
          />
          <ConfirmDialog
            open={cancelConfirm}
            title="Cancel invoice"
            message={`Cancel ${invoice.invoiceNo}? This is only possible while no payments are recorded.`}
            confirmLabel="Cancel invoice"
            busy={cancelling}
            onConfirm={async () => {
              setCancelling(true);
              try {
                await apiFetch(`/fees/invoices/${invoice.id}/cancel`, {
                  method: 'PATCH',
                });
                toast('Invoice cancelled');
                setCancelConfirm(false);
                load();
              } catch (err) {
                toast(err instanceof ApiError ? err.message : 'Cancel failed', 'error');
              } finally {
                setCancelling(false);
              }
            }}
            onClose={() => setCancelConfirm(false)}
          />
        </>
      ) : null}
    </div>
  );
}

function PaymentDialog({
  open,
  balance,
  invoiceId,
  onClose,
  onDone,
}: {
  open: boolean;
  balance: string;
  invoiceId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const form = useZodForm(recordPaymentSchema);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = form.validate(formValues(event.currentTarget));
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch(`/fees/invoices/${invoiceId}/payments`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    });
    if (done) onDone();
  }

  return (
    <Dialog
      open={open}
      title="Record payment"
      description={`Outstanding balance: ${balance}. Overpayments are rejected.`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input label="Amount" name="amount" type="number" min={0.01} step="0.01" error={form.fieldErrors.amount} />
        <Select
          label="Method"
          name="method"
          options={[
            { value: 'CASH', label: 'Cash' },
            { value: 'BANK_TRANSFER', label: 'Bank transfer' },
            { value: 'CHEQUE', label: 'Cheque' },
            { value: 'OTHER', label: 'Other' },
          ]}
          error={form.fieldErrors.method}
        />
        <Input label="Reference (optional)" name="reference" error={form.fieldErrors.reference} />
        <Input label="Paid on" name="paidAt" type="date" error={form.fieldErrors.paidAt} />
        {form.formError ? (
          <p className="rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700" role="alert">
            {form.formError}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={form.busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.busy}>
            {form.busy ? 'Recording…' : 'Record payment'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
