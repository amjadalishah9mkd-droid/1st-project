'use client';

import { FormEvent, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createStudentSchema,
  type DepartmentItem,
  type StudentImportSummary,
  type StudentItem,
} from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
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
import {
  InviteLinkDialog,
  toAbsoluteLink,
  type CredentialLinkInfo,
} from '@/components/invite-link-dialog';

export default function StudentsPage() {
  const list = useList<StudentItem>('/students');
  const departments = useOptions<DepartmentItem>('/departments');
  const { hasPermission } = useSession();
  const canManage = hasPermission('users.manage');
  const router = useRouter();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [invite, setInvite] = useState<{
    email: string;
    link: CredentialLinkInfo;
  } | null>(null);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Students"
        description="Directory of enrolled students across the college."
        actions={
          canManage ? (
            <>
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                Import CSV
              </Button>
              <Button onClick={() => setCreateOpen(true)}>Add student</Button>
            </>
          ) : undefined
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
        searchPlaceholder="Search name, email, roll no…"
        onPageChange={list.setPage}
        onRetry={list.refetch}
        onRowClick={(row) => router.push(`/students/${row.id}`)}
        emptyTitle="No students found"
        emptyMessage="Add students individually or import a CSV to get started."
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (row) => (
              <div>
                <p className="font-medium">
                  {row.firstName} {row.lastName}
                </p>
                <p className="text-xs text-ink-muted">{row.email}</p>
              </div>
            ),
          },
          { key: 'rollNo', header: 'Roll no', render: (row) => row.rollNo },
          {
            key: 'admissionNo',
            header: 'Admission no',
            render: (row) => row.admissionNo,
          },
          {
            key: 'department',
            header: 'Department',
            render: (row) => row.departmentName,
          },
          { key: 'batch', header: 'Batch', render: (row) => row.batch },
          {
            key: 'enrollments',
            header: 'Sections',
            render: (row) => row.enrollmentCount,
          },
          {
            key: 'status',
            header: 'Status',
            render: (row) => (
              <Badge tone={statusTone(row.status)}>{row.status}</Badge>
            ),
          },
        ]}
      />

      {canManage ? (
        <>
          <CreateStudentDialog
            open={createOpen}
            departments={departments}
            onClose={() => setCreateOpen(false)}
            onCreated={(email, invite) => {
              setCreateOpen(false);
              list.refetch();
              setInvite({ email, link: invite });
              toast(`Student created: ${email}`, 'success');
            }}
          />
          <ImportStudentsDialog
            open={importOpen}
            onClose={() => setImportOpen(false)}
            onImported={(summary) => {
              list.refetch();
              toast(
                `Import finished: ${summary.created} created, ${summary.failed} failed`,
                summary.failed > 0 ? 'info' : 'success',
              );
            }}
          />
          <InviteLinkDialog
            open={invite !== null}
            title="Invitation link"
            description={
              invite ? `Send this link to ${invite.email} to set a password.` : ''
            }
            link={invite?.link ?? null}
            onClose={() => setInvite(null)}
          />
        </>
      ) : null}
    </div>
  );
}

function CreateStudentDialog({
  open,
  departments,
  onClose,
  onCreated,
}: {
  open: boolean;
  departments: DepartmentItem[];
  onClose: () => void;
  onCreated: (email: string, invite: CredentialLinkInfo) => void;
}) {
  const form = useZodForm(createStudentSchema);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = form.validate(formValues(event.currentTarget));
    if (!input) return;
    await form.submit(async () => {
      const response = await apiFetch<{
        student: StudentItem;
        invite: CredentialLinkInfo;
      }>('/students', { method: 'POST', body: JSON.stringify(input) });
      onCreated(response.data.student.email, response.data.invite);
    });
  }

  return (
    <Dialog
      open={open}
      title="Add student"
      description="Creates the account and issues a one-time invitation link the student uses to set their password."
      onClose={onClose}
      wide
    >
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Input label="First name" name="firstName" error={form.fieldErrors.firstName} />
        <Input label="Last name" name="lastName" error={form.fieldErrors.lastName} />
        <Input label="Email" name="email" type="email" error={form.fieldErrors.email} />
        <Select
          label="Department"
          name="departmentId"
          placeholder="Select department"
          options={departments.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` }))}
          error={form.fieldErrors.departmentId}
        />
        <Input label="Admission no" name="admissionNo" error={form.fieldErrors.admissionNo} />
        <Input label="Roll no" name="rollNo" error={form.fieldErrors.rollNo} />
        <Input label="Batch" name="batch" placeholder="2026" error={form.fieldErrors.batch} />
        <Input label="Phone (optional)" name="phone" error={form.fieldErrors.phone} />
        <Input label="Guardian name (optional)" name="guardianName" error={form.fieldErrors.guardianName} />
        <Input label="Guardian phone (optional)" name="guardianPhone" error={form.fieldErrors.guardianPhone} />
        {form.formError ? (
          <p className="sm:col-span-2 rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700" role="alert">
            {form.formError}
          </p>
        ) : null}
        <div className="sm:col-span-2 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={form.busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.busy}>
            {form.busy ? 'Creating…' : 'Create student'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ImportStudentsDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (summary: StudentImportSummary) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<StudentImportSummary | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Choose a CSV file first');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/v1/students/import', {
        method: 'POST',
        body,
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${(await import('@/lib/auth/token-store')).getAccessToken() ?? ''}`,
        },
      });
      const json = await response.json();
      if (!response.ok) {
        throw new ApiError(
          json?.error?.code ?? 'UNKNOWN',
          json?.error?.message ?? 'Import failed',
          response.status,
        );
      }
      setSummary(json.data as StudentImportSummary);
      onImported(json.data as StudentImportSummary);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="Import students from CSV"
      description="Header row must be: firstName,lastName,email,admissionNo,rollNo,batch,departmentCode"
      onClose={() => {
        setSummary(null);
        setError(null);
        onClose();
      }}
      wide
    >
      {summary ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            <span className="font-semibold text-success-700">{summary.created} created</span>
            {' · '}
            <span className={summary.failed ? 'font-semibold text-danger-700' : ''}>
              {summary.failed} failed
            </span>
          </p>
          {summary.errors.length > 0 ? (
            <div className="max-h-40 overflow-y-auto rounded-card border border-line bg-surface p-3 text-xs">
              {summary.errors.map((entry) => (
                <p key={entry.row} className="text-danger-700">
                  Row {entry.row}: {entry.message}
                </p>
              ))}
            </div>
          ) : null}
          {summary.createdStudents.length > 0 ? (
            <div className="max-h-48 overflow-y-auto rounded-card border border-line bg-surface p-3 text-xs">
              <p className="mb-2 font-semibold">
                Invitation links (share securely — shown once, expire in 48h):
              </p>
              {summary.createdStudents.map((entry) => (
                <p key={entry.row} className="break-all font-mono">
                  {entry.email} → {toAbsoluteLink(entry.inviteUrl)}
                </p>
              ))}
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button
              onClick={() => {
                setSummary(null);
                onClose();
              }}
            >
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            className="rounded-lg border border-line-strong bg-surface p-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
          />
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
              {busy ? 'Importing…' : 'Import'}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
