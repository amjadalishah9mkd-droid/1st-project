'use client';

import { FormEvent, useState } from 'react';
import {
  createAcademicYearSchema,
  createTermSchema,
  updateAcademicYearSchema,
  updateTermSchema,
  type AcademicYearItem,
  type TermItem,
} from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useList } from '@/lib/hooks/use-list';
import { formValues, useZodForm } from '@/lib/hooks/use-zod-form';
import { useToast } from '@/components/providers/toast-provider';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

/**
 * M15-W1 — Academic calendar administration (/calendar).
 * A thin UI over the EXISTING calendar APIs (academic-years + terms CRUD,
 * PATCH /terms/:id/set-current). All authorization and tenancy live
 * server-side (academics.manage); the route/nav gating here is a hint
 * only. No client-controlled collegeId is ever sent — the server derives
 * the college from the session. Rollover arrives in M15-W2/W3; this page
 * deliberately contains no rollover actions.
 */
export default function CalendarPage() {
  const years = useList<AcademicYearItem>('/academic-years');
  const terms = useList<TermItem>('/terms');
  const { toast } = useToast();
  const [yearOpen, setYearOpen] = useState(false);
  const [editingYear, setEditingYear] = useState<AcademicYearItem | null>(null);
  const [termOpen, setTermOpen] = useState(false);
  const [editingTerm, setEditingTerm] = useState<TermItem | null>(null);
  const [makeCurrent, setMakeCurrent] = useState<TermItem | null>(null);
  const [settingCurrent, setSettingCurrent] = useState(false);

  const currentTerm = terms.rows.find((term) => term.isCurrent) ?? null;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Academic calendar"
        description={
          currentTerm
            ? `Current term: ${currentTerm.label} (${currentTerm.academicYearLabel}).`
            : 'No current term is set — dashboards and new sections need one.'
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setYearOpen(true)}>
              New academic year
            </Button>
            <Button onClick={() => setTermOpen(true)} disabled={years.rows.length === 0}>
              New term
            </Button>
          </>
        }
      />

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">Academic years</h2>
        <DataTable
          rowKey={(row) => row.id}
          rows={years.rows}
          meta={years.meta}
          loading={years.loading}
          error={years.error}
          onPageChange={years.setPage}
          onRetry={years.refetch}
          emptyTitle="No academic years"
          emptyMessage="Create an academic year to group its terms."
          columns={[
            { key: 'label', header: 'Year', render: (row) => <span className="font-medium">{row.label}</span> },
            { key: 'starts', header: 'Starts', render: (row) => row.startsOn },
            { key: 'ends', header: 'Ends', render: (row) => row.endsOn },
            { key: 'terms', header: 'Terms', render: (row) => row.termCount },
            {
              key: 'actions',
              header: '',
              className: 'w-16 text-right',
              render: (row) => (
                <Button variant="ghost" size="sm" onClick={() => setEditingYear(row)}>
                  Edit
                </Button>
              ),
            },
          ]}
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Terms</h2>
        <DataTable
          rowKey={(row) => row.id}
          rows={terms.rows}
          meta={terms.meta}
          loading={terms.loading}
          error={terms.error}
          onPageChange={terms.setPage}
          onRetry={terms.refetch}
          emptyTitle="No terms"
          emptyMessage="Create a term inside an academic year."
          columns={[
            {
              key: 'label',
              header: 'Term',
              render: (row) => (
                <span className="font-medium">
                  {row.label}
                  {row.isCurrent ? (
                    <span className="ml-2 inline-block align-middle">
                      <Badge tone="success">Current</Badge>
                    </span>
                  ) : null}
                </span>
              ),
            },
            { key: 'year', header: 'Academic year', render: (row) => row.academicYearLabel },
            { key: 'starts', header: 'Starts', render: (row) => row.startsOn },
            { key: 'ends', header: 'Ends', render: (row) => row.endsOn },
            { key: 'sections', header: 'Sections', render: (row) => row.sectionCount },
            {
              key: 'actions',
              header: '',
              className: 'w-44 text-right',
              render: (row) => (
                <div className="flex justify-end gap-2">
                  {!row.isCurrent ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setMakeCurrent(row)}
                    >
                      Set current
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" onClick={() => setEditingTerm(row)}>
                    Edit
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </section>

      <YearDialog
        open={yearOpen}
        onClose={() => setYearOpen(false)}
        onSaved={() => {
          setYearOpen(false);
          toast('Academic year created');
          years.refetch();
        }}
      />
      {editingYear ? (
        <EditYearDialog
          year={editingYear}
          onClose={() => setEditingYear(null)}
          onSaved={() => {
            setEditingYear(null);
            toast('Academic year updated');
            years.refetch();
          }}
        />
      ) : null}
      <TermDialog
        open={termOpen}
        years={years.rows}
        onClose={() => setTermOpen(false)}
        onSaved={() => {
          setTermOpen(false);
          toast('Term created');
          terms.refetch();
          years.refetch();
        }}
      />
      {editingTerm ? (
        <EditTermDialog
          term={editingTerm}
          onClose={() => setEditingTerm(null)}
          onSaved={() => {
            setEditingTerm(null);
            toast('Term updated');
            terms.refetch();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={makeCurrent !== null}
        title="Set current term"
        message={
          makeCurrent
            ? `Make "${makeCurrent.label}" the current term? ${
                currentTerm ? `"${currentTerm.label}" will no longer be current. ` : ''
              }Dashboards and new work will use the current term.`
            : ''
        }
        confirmLabel="Set current"
        busy={settingCurrent}
        onConfirm={async () => {
          if (!makeCurrent || settingCurrent) return;
          setSettingCurrent(true);
          try {
            await apiFetch(`/terms/${makeCurrent.id}/set-current`, {
              method: 'PATCH',
            });
            toast(`"${makeCurrent.label}" is now the current term`);
            setMakeCurrent(null);
            terms.refetch();
          } catch (err) {
            toast(err instanceof ApiError ? err.message : 'Could not set current term', 'error');
          } finally {
            setSettingCurrent(false);
          }
        }}
        onClose={() => setMakeCurrent(null)}
      />
    </div>
  );
}

// ── Dialogs (existing useZodForm + shared-schema pattern) ────

function YearDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useZodForm(createAcademicYearSchema);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = form.validate(formValues(event.currentTarget));
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch('/academic-years', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    });
    if (done) onSaved();
  }
  return (
    <Dialog
      open={open}
      title="New academic year"
      description="A label and its overall date range, e.g. 2026–2027."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input label="Label" name="label" placeholder="2026–2027" error={form.fieldErrors.label} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Starts on" name="startsOn" type="date" error={form.fieldErrors.startsOn} />
          <Input label="Ends on" name="endsOn" type="date" error={form.fieldErrors.endsOn} />
        </div>
        {form.formError ? (
          <p className="text-sm text-danger-700" role="alert">
            {form.formError}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" type="button" onClick={onClose} disabled={form.busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.busy}>
            {form.busy ? 'Creating…' : 'Create year'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditYearDialog({
  year,
  onClose,
  onSaved,
}: {
  year: AcademicYearItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useZodForm(updateAcademicYearSchema);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = form.validate(formValues(event.currentTarget));
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch(`/academic-years/${year.id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
    });
    if (done) onSaved();
  }
  return (
    <Dialog
      open
      title={`Edit ${year.label}`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input label="Label" name="label" defaultValue={year.label} error={form.fieldErrors.label} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Starts on" name="startsOn" type="date" defaultValue={year.startsOn} error={form.fieldErrors.startsOn} />
          <Input label="Ends on" name="endsOn" type="date" defaultValue={year.endsOn} error={form.fieldErrors.endsOn} />
        </div>
        {form.formError ? (
          <p className="text-sm text-danger-700" role="alert">
            {form.formError}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" type="button" onClick={onClose} disabled={form.busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.busy}>
            {form.busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function TermDialog({
  open,
  years,
  onClose,
  onSaved,
}: {
  open: boolean;
  years: AcademicYearItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useZodForm(createTermSchema);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = form.validate(formValues(event.currentTarget));
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch('/terms', { method: 'POST', body: JSON.stringify(input) });
    });
    if (done) onSaved();
  }
  return (
    <Dialog
      open={open}
      title="New term"
      description="Terms live inside an academic year, e.g. Fall 2026."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Select
          label="Academic year"
          name="academicYearId"
          placeholder="Select academic year"
          options={years.map((year) => ({ value: year.id, label: year.label }))}
          error={form.fieldErrors.academicYearId}
        />
        <Input label="Label" name="label" placeholder="Spring 2027" error={form.fieldErrors.label} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Starts on" name="startsOn" type="date" error={form.fieldErrors.startsOn} />
          <Input label="Ends on" name="endsOn" type="date" error={form.fieldErrors.endsOn} />
        </div>
        {form.formError ? (
          <p className="text-sm text-danger-700" role="alert">
            {form.formError}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" type="button" onClick={onClose} disabled={form.busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.busy}>
            {form.busy ? 'Creating…' : 'Create term'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditTermDialog({
  term,
  onClose,
  onSaved,
}: {
  term: TermItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useZodForm(updateTermSchema);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = form.validate(formValues(event.currentTarget));
    if (!input) return;
    const done = await form.submit(async () => {
      await apiFetch(`/terms/${term.id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
    });
    if (done) onSaved();
  }
  return (
    <Dialog open title={`Edit ${term.label}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input label="Label" name="label" defaultValue={term.label} error={form.fieldErrors.label} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Starts on" name="startsOn" type="date" defaultValue={term.startsOn} error={form.fieldErrors.startsOn} />
          <Input label="Ends on" name="endsOn" type="date" defaultValue={term.endsOn} error={form.fieldErrors.endsOn} />
        </div>
        {form.formError ? (
          <p className="text-sm text-danger-700" role="alert">
            {form.formError}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" type="button" onClick={onClose} disabled={form.busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.busy}>
            {form.busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
