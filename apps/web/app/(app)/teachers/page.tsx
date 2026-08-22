'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createTeacherSchema,
  type DepartmentItem,
  type TeacherItem,
} from '@campusos/shared';
import { apiFetch } from '@/lib/api/client';
import { useList, useOptions } from '@/lib/hooks/use-list';
import { formValues, useZodForm } from '@/lib/hooks/use-zod-form';
import { useToast } from '@/components/providers/toast-provider';
import { useSession } from '@/components/providers/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data/data-table';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  InviteLinkDialog,
  type CredentialLinkInfo,
} from '@/components/invite-link-dialog';

export default function TeachersPage() {
  const list = useList<TeacherItem>('/teachers');
  const departments = useOptions<DepartmentItem>('/departments');
  const { hasPermission } = useSession();
  const canManage = hasPermission('users.manage');
  const router = useRouter();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [invite, setInvite] = useState<{
    email: string;
    link: CredentialLinkInfo;
  } | null>(null);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Teachers"
        description="Faculty directory and teaching workload."
        actions={
          canManage ? (
            <Button onClick={() => setCreateOpen(true)}>Add teacher</Button>
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
        searchPlaceholder="Search name, email, employee no…"
        onPageChange={list.setPage}
        onRetry={list.refetch}
        onRowClick={(row) => router.push(`/teachers/${row.id}`)}
        emptyTitle="No teachers found"
        emptyMessage="Add faculty members to start assigning sections."
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
          { key: 'employeeNo', header: 'Employee no', render: (row) => row.employeeNo },
          { key: 'designation', header: 'Designation', render: (row) => row.designation },
          { key: 'department', header: 'Department', render: (row) => row.departmentName },
          { key: 'sections', header: 'Sections', render: (row) => row.sectionCount },
          { key: 'joined', header: 'Joined', render: (row) => row.joinedOn },
        ]}
      />

      {canManage ? (
        <>
          <CreateTeacherDialog
            open={createOpen}
            departments={departments}
            onClose={() => setCreateOpen(false)}
            onCreated={(email, invite) => {
              setCreateOpen(false);
              list.refetch();
              setInvite({ email, link: invite });
              toast(`Teacher created: ${email}`, 'success');
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

function CreateTeacherDialog({
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
  const form = useZodForm(createTeacherSchema);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = form.validate(formValues(event.currentTarget));
    if (!input) return;
    await form.submit(async () => {
      const response = await apiFetch<{
        teacher: TeacherItem;
        invite: CredentialLinkInfo;
      }>('/teachers', { method: 'POST', body: JSON.stringify(input) });
      onCreated(response.data.teacher.email, response.data.invite);
    });
  }

  return (
    <Dialog
      open={open}
      title="Add teacher"
      description="Creates the account and issues a one-time invitation link the teacher uses to set their password."
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
        <Input label="Employee no" name="employeeNo" error={form.fieldErrors.employeeNo} />
        <Input label="Designation" name="designation" placeholder="Assistant Professor" error={form.fieldErrors.designation} />
        <Input label="Qualification (optional)" name="qualification" error={form.fieldErrors.qualification} />
        <Input label="Joined on" name="joinedOn" type="date" error={form.fieldErrors.joinedOn} />
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
            {form.busy ? 'Creating…' : 'Create teacher'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
