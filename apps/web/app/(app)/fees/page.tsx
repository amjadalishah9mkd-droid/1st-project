'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createFeeStructureSchema,
  generateInvoicesSchema,
  type CourseItem,
  type FeeStructureItem,
  type FeeSummary,
  type InvoiceItem,
  type ReconciliationAttemptItem,
  type TermItem,
  type UnmatchedGatewayEventItem,
} from '@campusos/shared';
import { apiFetch } from '@/lib/api/client';
import { useList, useOptions } from '@/lib/hooks/use-list';
import { formValues, useZodForm } from '@/lib/hooks/use-zod-form';
import { useToast } from '@/components/providers/toast-provider';
import { useSession } from '@/components/providers/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data/data-table';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { invoiceTone } from './fee-utils';
import { RefundsReconciliationView } from './refunds';
import { formatAmount } from '@/lib/format';
import { ExportCsvButton } from '@/components/export-csv-button';

export default function FeesPage() {
  const { hasPermission } = useSession();
  const canManage = hasPermission('fees.manage');
  return canManage ? <AdminFeesView /> : <StudentFeesView />;
}

// ── Student view ─────────────────────────────────────────────

function StudentFeesView() {
  const list = useList<InvoiceItem>('/fees/invoices');
  const router = useRouter();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="My fees"
        description="Your invoices and payment status."
        actions={
          <Button variant="secondary" onClick={() => router.push('/fees/documents')}>
            My receipts
          </Button>
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
        onRowClick={(row) => router.push(`/fees/invoices/${row.id}`)}
        emptyTitle="No invoices"
        emptyMessage="Invoices issued to you will appear here."
        columns={[
          { key: 'no', header: 'Invoice', render: (row) => <span className="font-mono text-xs">{row.invoiceNo}</span> },
          { key: 'name', header: 'Fee', render: (row) => row.structureName },
          { key: 'amount', header: 'Amount', render: (row) => formatAmount(row.amount) },
          { key: 'balance', header: 'Balance', render: (row) => formatAmount(row.balance) },
          { key: 'due', header: 'Due', render: (row) => row.dueDate },
          {
            key: 'status',
            header: 'Status',
            render: (row) => <Badge tone={invoiceTone(row.status)}>{row.status}</Badge>,
          },
        ]}
      />
    </div>
  );
}

// ── Admin view ───────────────────────────────────────────────

type Tab = 'invoices' | 'structures' | 'reconciliation' | 'refunds';

function AdminFeesView() {
  const [tab, setTab] = useState<Tab>('invoices');
  const invoices = useList<InvoiceItem>('/fees/invoices');
  const structures = useList<FeeStructureItem>('/fees/structures');
  const terms = useOptions<TermItem>('/terms');
  const courses = useOptions<CourseItem>('/courses');
  const [summary, setSummary] = useState<FeeSummary | null>(null);
  const [structureOpen, setStructureOpen] = useState(false);
  const [editingStructure, setEditingStructure] = useState<FeeStructureItem | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const loadSummary = () => {
    apiFetch<FeeSummary>('/fees/summary')
      .then((response) => setSummary(response.data))
      .catch(() => undefined);
  };
  useEffect(loadSummary, []);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Fees"
        description="Fee structures, invoices and manually recorded payments."
        actions={
          <>
            <Button variant="secondary" onClick={() => router.push('/fees/documents')}>
              Documents
            </Button>
            <ExportCsvButton
              permission="fees.read"
              path="/exports/fees.csv"
              filename="fees.csv"
            />
            <Button variant="secondary" onClick={() => setStructureOpen(true)}>
              New structure
            </Button>
            <Button onClick={() => setGenerateOpen(true)}>Generate invoices</Button>
          </>
        }
      />

      {summary ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Invoiced', formatAmount(summary.invoicedTotal)],
            ['Collected', formatAmount(summary.collectedTotal)],
            ['Outstanding', formatAmount(summary.outstandingTotal)],
            ['Overdue invoices', String(summary.overdueCount)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-card border border-line bg-surface-raised p-4 shadow-card">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
              <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mb-4 flex gap-1 border-b border-line" role="tablist">
        {(
          [
            ['invoices', `Invoices`],
            ['structures', `Structures`],
            ['reconciliation', `Reconciliation`],
            ['refunds', `Refunds`],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'invoices' ? (
        <DataTable
          rowKey={(row) => row.id}
          rows={invoices.rows}
          meta={invoices.meta}
          loading={invoices.loading}
          error={invoices.error}
          search={invoices.search}
          onSearchChange={invoices.onSearchChange}
          searchPlaceholder="Search invoice no or student…"
          onPageChange={invoices.setPage}
          onRetry={invoices.refetch}
          onRowClick={(row) => router.push(`/fees/invoices/${row.id}`)}
          emptyTitle="No invoices"
          emptyMessage="Generate invoices from a fee structure."
          columns={[
            { key: 'no', header: 'Invoice', render: (row) => <span className="font-mono text-xs">{row.invoiceNo}</span> },
            {
              key: 'student',
              header: 'Student',
              render: (row) => (
                <div>
                  <p className="font-medium">{row.studentName}</p>
                  <p className="font-mono text-xs text-ink-muted">{row.rollNo}</p>
                </div>
              ),
            },
            { key: 'fee', header: 'Fee', render: (row) => row.structureName },
            { key: 'amount', header: 'Amount', render: (row) => formatAmount(row.amount) },
            { key: 'balance', header: 'Balance', render: (row) => formatAmount(row.balance) },
            { key: 'due', header: 'Due', render: (row) => row.dueDate },
            {
              key: 'status',
              header: 'Status',
              render: (row) => <Badge tone={invoiceTone(row.status)}>{row.status}</Badge>,
            },
          ]}
        />
      ) : tab === 'structures' ? (
        <DataTable
          rowKey={(row) => row.id}
          rows={structures.rows}
          meta={structures.meta}
          loading={structures.loading}
          error={structures.error}
          onPageChange={structures.setPage}
          onRetry={structures.refetch}
          emptyTitle="No fee structures"
          emptyMessage="Create a structure to define what students are billed."
          columns={[
            { key: 'name', header: 'Name', render: (row) => row.name },
            { key: 'term', header: 'Term', render: (row) => row.termLabel },
            {
              key: 'scope',
              header: 'Applies to',
              render: (row) => row.courseCode ?? 'All students',
            },
            {
              key: 'components',
              header: 'Components',
              render: (row) =>
                row.components.map((c) => `${c.label} (${c.amount})`).join(', '),
            },
            { key: 'total', header: 'Total', render: (row) => formatAmount(row.totalAmount) },
            { key: 'invoices', header: 'Invoices', render: (row) => row.invoiceCount },
            {
              key: 'actions',
              header: '',
              className: 'w-16 text-right',
              render: (row) => (
                <Button variant="ghost" size="sm" onClick={() => setEditingStructure(row)}>
                  Edit
                </Button>
              ),
            },
          ]}
        />
      ) : tab === 'refunds' ? (
        <RefundsReconciliationView />
      ) : (
        <ReconciliationView
          onSettled={() => {
            invoices.refetch();
            loadSummary();
          }}
        />
      )}

      <StructureDialog
        open={structureOpen}
        terms={terms}
        courses={courses}
        onClose={() => setStructureOpen(false)}
        onSaved={() => {
          setStructureOpen(false);
          toast('Fee structure created');
          structures.refetch();
        }}
      />
      {editingStructure ? (
        <EditStructureDialog
          structure={editingStructure}
          onClose={() => setEditingStructure(null)}
          onSaved={() => {
            setEditingStructure(null);
            toast('Fee structure updated');
            structures.refetch();
            loadSummary();
          }}
        />
      ) : null}
      <GenerateDialog
        open={generateOpen}
        structures={structures.rows}
        onClose={() => setGenerateOpen(false)}
        onDone={(created, skipped) => {
          setGenerateOpen(false);
          toast(`${created} invoice(s) created, ${skipped} skipped`, 'info');
          invoices.refetch();
          structures.refetch();
          loadSummary();
        }}
      />
    </div>
  );
}

function StructureDialog({
  open,
  terms,
  courses,
  onClose,
  onSaved,
}: {
  open: boolean;
  terms: TermItem[];
  courses: CourseItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useZodForm(createFeeStructureSchema);
  const [components, setComponents] = useState([{ label: 'Tuition', amount: '' }]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = formValues(event.currentTarget);
    raw.components = components
      .filter((component) => component.label.trim() && component.amount !== '')
      .map((component) => ({
        label: component.label.trim(),
        amount: Number(component.amount),
      }));
    const input = form.validate(raw);
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch('/fees/structures', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    });
    if (done) {
      setComponents([{ label: 'Tuition', amount: '' }]);
      onSaved();
    }
  }

  return (
    <Dialog
      open={open}
      title="New fee structure"
      description="Total is calculated from the components. Leave the course empty to apply to all students."
      onClose={onClose}
      wide
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input label="Name" name="name" placeholder="Fall 2026 Tuition" error={form.fieldErrors.name} />
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Term"
            name="termId"
            placeholder="Select term"
            options={terms.map((term) => ({
              value: term.id,
              label: `${term.label}${term.isCurrent ? ' (current)' : ''}`,
            }))}
            error={form.fieldErrors.termId}
          />
          <Select
            label="Course (optional)"
            name="courseId"
            placeholder="All students"
            options={courses.map((course) => ({
              value: course.id,
              label: `${course.code} — ${course.title}`,
            }))}
            error={form.fieldErrors.courseId}
          />
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Components</p>
          {components.map((component, index) => (
            <div key={index} className="flex gap-2">
              <input
                aria-label={`Component ${index + 1} label`}
                value={component.label}
                onChange={(event) =>
                  setComponents((current) =>
                    current.map((c, i) =>
                      i === index ? { ...c, label: event.target.value } : c,
                    ),
                  )
                }
                placeholder="Label"
                className="h-10 flex-1 rounded-lg border border-line-strong bg-surface-raised px-3 text-sm"
              />
              <input
                aria-label={`Component ${index + 1} amount`}
                type="number"
                min={0}
                value={component.amount}
                onChange={(event) =>
                  setComponents((current) =>
                    current.map((c, i) =>
                      i === index ? { ...c, amount: event.target.value } : c,
                    ),
                  )
                }
                placeholder="Amount"
                className="h-10 w-32 rounded-lg border border-line-strong bg-surface-raised px-3 text-right text-sm"
              />
              {components.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setComponents((current) => current.filter((_, i) => i !== index))
                  }
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                setComponents((current) => [...current, { label: '', amount: '' }])
              }
            >
              Add component
            </Button>
          </div>
          {form.fieldErrors.components ? (
            <p className="text-xs text-danger-700">{form.fieldErrors.components}</p>
          ) : null}
        </div>

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
            {form.busy ? 'Creating…' : 'Create structure'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function GenerateDialog({
  open,
  structures,
  onClose,
  onDone,
}: {
  open: boolean;
  structures: FeeStructureItem[];
  onClose: () => void;
  onDone: (created: number, skipped: number) => void;
}) {
  const form = useZodForm(generateInvoicesSchema);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = form.validate(formValues(event.currentTarget));
    if (!input) return;
    await form.submit(async () => {
      const response = await apiFetch<{ created: number; skipped: number }>(
        '/fees/invoices/generate',
        { method: 'POST', body: JSON.stringify(input) },
      );
      onDone(response.data.created, response.data.skipped);
    });
  }

  return (
    <Dialog
      open={open}
      title="Generate invoices"
      description="Creates one invoice per eligible student; students already invoiced for this structure are skipped."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Select
          label="Fee structure"
          name="structureId"
          placeholder={structures.length ? 'Select structure' : 'No structures yet'}
          options={structures.map((structure) => ({
            value: structure.id,
            label: `${structure.name} (${structure.totalAmount})`,
          }))}
          error={form.fieldErrors.structureId}
        />
        <Input label="Due date" name="dueDate" type="date" error={form.fieldErrors.dueDate} />
        {form.formError ? (
          <p className="rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700" role="alert">
            {form.formError}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={form.busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.busy || structures.length === 0}>
            {form.busy ? 'Generating…' : 'Generate'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}


function EditStructureDialog({
  structure,
  onClose,
  onSaved,
}: {
  structure: FeeStructureItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(structure.name);
  const [components, setComponents] = useState(
    structure.components.map((component) => ({
      label: component.label,
      amount: component.amount,
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cleaned = components
      .filter((component) => component.label.trim() && component.amount !== '')
      .map((component) => ({
        label: component.label.trim(),
        amount: Number(component.amount),
      }));
    if (cleaned.length === 0) {
      setError('Add at least one component');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/fees/structures/${structure.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim(), components: cleaned }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title={`Edit ${structure.name}`}
      description="Existing invoices keep their snapshotted amounts; only future invoices use the new total."
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Input
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Components</p>
          {components.map((component, index) => (
            <div key={index} className="flex gap-2">
              <input
                aria-label={`Component ${index + 1} label`}
                value={component.label}
                onChange={(event) =>
                  setComponents((current) =>
                    current.map((c, i) =>
                      i === index ? { ...c, label: event.target.value } : c,
                    ),
                  )
                }
                className="h-10 flex-1 rounded-lg border border-line-strong bg-surface-raised px-3 text-sm"
              />
              <input
                aria-label={`Component ${index + 1} amount`}
                type="number"
                min={0}
                value={component.amount}
                onChange={(event) =>
                  setComponents((current) =>
                    current.map((c, i) =>
                      i === index ? { ...c, amount: event.target.value } : c,
                    ),
                  )
                }
                className="h-10 w-32 rounded-lg border border-line-strong bg-surface-raised px-3 text-right text-sm"
              />
              {components.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setComponents((current) => current.filter((_, i) => i !== index))
                  }
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                setComponents((current) => [...current, { label: '', amount: '' }])
              }
            >
              Add component
            </Button>
          </div>
        </div>
        {error ? (
          <p className="rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ── M14-W5: admin reconciliation (fees.manage — UI hint only; every
// API below is independently authorized server-side) ─────────

const ATTEMPT_STATUSES = [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
  'CREATED',
] as const;

function attemptTone(
  status: ReconciliationAttemptItem['status'],
): 'neutral' | 'success' | 'warning' | 'danger' | 'brand' {
  switch (status) {
    case 'SUCCEEDED':
      return 'success';
    case 'FAILED':
      return 'danger';
    case 'PENDING':
    case 'CREATED':
      return 'brand';
    default:
      return 'neutral';
  }
}

function ReconciliationView({ onSettled }: { onSettled: () => void }) {
  const [status, setStatus] = useState('');
  const attempts = useList<ReconciliationAttemptItem>('/payments/reconciliation', {
    status: status || undefined,
  });
  const [unmatched, setUnmatched] = useState<UnmatchedGatewayEventItem[]>([]);
  const [verifying, setVerifying] = useState<string | null>(null);
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    apiFetch<UnmatchedGatewayEventItem[]>('/payments/reconciliation/unmatched')
      .then((response) => setUnmatched(response.data))
      .catch(() => undefined);
  }, []);

  // The browser only REQUESTS verification — the server asks the gateway
  // and the settlement core decides. No status/amount is ever sent.
  async function verify(attemptId: string) {
    if (verifying) return;
    setVerifying(attemptId);
    try {
      const response = await apiFetch<{ status: string; outcome: string }>(
        `/payments/reconciliation/${attemptId}/verify`,
        { method: 'POST' },
      );
      const { status: newStatus, outcome } = response.data;
      toast(
        outcome === 'SETTLED'
          ? 'Payment confirmed and settled.'
          : outcome === 'STILL_PENDING'
            ? 'The provider has not confirmed this payment yet.'
            : outcome === 'FAILED'
              ? 'The provider reports this payment failed.'
              : `Attempt is ${newStatus}.`,
        outcome === 'SETTLED' ? undefined : 'error',
      );
      attempts.refetch();
      if (outcome === 'SETTLED') onSettled();
    } catch {
      toast('Verification failed — please try again.', 'error');
    } finally {
      setVerifying(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-xs">
        <Select
          label="Status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            attempts.setPage(1);
          }}
          placeholder="All statuses"
          options={ATTEMPT_STATUSES.map((value) => ({ value, label: value }))}
        />
      </div>

      <DataTable
        rowKey={(row) => row.id}
        rows={attempts.rows}
        meta={attempts.meta}
        loading={attempts.loading}
        error={attempts.error}
        onPageChange={attempts.setPage}
        onRetry={attempts.refetch}
        emptyTitle="No online payment attempts"
        emptyMessage="Attempts appear here once students start paying online."
        columns={[
          {
            key: 'invoice',
            header: 'Invoice',
            render: (row) => (
              <button
                className="font-mono text-xs text-brand-700 hover:underline"
                onClick={() => router.push(`/fees/invoices/${row.invoiceId}`)}
              >
                {row.invoiceNo}
              </button>
            ),
          },
          {
            key: 'student',
            header: 'Student',
            render: (row) => (
              <span>
                {row.studentName}{' '}
                <span className="text-xs text-ink-muted">({row.rollNo})</span>
              </span>
            ),
          },
          { key: 'amount', header: 'Amount', render: (row) => `${formatAmount(row.amount)} ${row.currency}` },
          {
            key: 'provider',
            header: 'Provider',
            render: (row) => (
              <span>
                {row.provider}
                {row.providerRef ? (
                  <span className="block font-mono text-[10px] text-ink-muted">
                    {row.providerRef}
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            key: 'created',
            header: 'Created',
            render: (row) => new Date(row.createdAt).toLocaleString(),
          },
          {
            key: 'status',
            header: 'Status',
            render: (row) => (
              <div className="flex flex-col items-start gap-1">
                <Badge tone={attemptTone(row.status)}>{row.status}</Badge>
                {row.overpaid ? (
                  <Badge tone="warning">Overpaid — manual investigation required</Badge>
                ) : null}
                {row.failureCode ? (
                  <span className="text-[10px] text-ink-muted">{row.failureCode}</span>
                ) : null}
              </div>
            ),
          },
          {
            key: 'actions',
            header: '',
            className: 'w-36 text-right',
            render: (row) =>
              row.status === 'PENDING' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={verifying !== null}
                  onClick={() => verify(row.id)}
                >
                  {verifying === row.id ? 'Verifying…' : 'Verify with gateway'}
                </Button>
              ) : null,
          },
        ]}
      />

      {unmatched.length > 0 ? (
        <section className="rounded-card border border-warning-500/40 bg-surface-raised shadow-card">
          <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">
            Unmatched gateway events ({unmatched.length})
          </h2>
          <p className="px-5 pt-2 text-xs text-ink-muted">
            Signed deliveries whose transaction reference matched no payment
            attempt. Cross-check these against the provider dashboard.
          </p>
          <ul className="divide-y divide-line text-sm">
            {unmatched.map((event) => (
              <li key={event.id} className="flex flex-wrap justify-between gap-2 px-5 py-2.5">
                <span className="font-mono text-xs">{event.eventId}</span>
                <span className="text-xs text-ink-muted">
                  {event.provider} · {event.outcome} ·{' '}
                  {new Date(event.receivedAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
