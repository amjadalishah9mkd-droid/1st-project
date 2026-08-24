'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { GuardianLinkItem } from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useToast } from '@/components/providers/toast-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  InviteLinkDialog,
  type CredentialLinkInfo,
} from '@/components/invite-link-dialog';

/**
 * M13-W2 — admin Guardians card on the student detail page (decision H1).
 * Invite / list / revoke; invite URLs surface via the existing
 * InviteLinkDialog (copy-paste works even without SMTP).
 */
export function GuardiansCard({ studentProfileId }: { studentProfileId: string }) {
  const { toast } = useToast();
  const [links, setLinks] = useState<GuardianLinkItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState<{
    email: string;
    link: CredentialLinkInfo;
  } | null>(null);
  const [busyLinkId, setBusyLinkId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    apiFetch<GuardianLinkItem[]>(`/students/${studentProfileId}/guardians`)
      .then((response) => setLinks(response.data))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load guardians'),
      );
  }, [studentProfileId]);
  useEffect(load, [load]);

  async function revoke(linkId: string) {
    setBusyLinkId(linkId);
    try {
      await apiFetch(`/students/${studentProfileId}/guardians/${linkId}`, {
        method: 'DELETE',
      });
      toast('Guardian access revoked');
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Revoke failed', 'error');
    } finally {
      setBusyLinkId(null);
    }
  }

  return (
    <section className="rounded-card border border-line bg-surface-raised p-5 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          Guardians {links ? `(${links.filter((l) => l.status === 'ACTIVE').length})` : ''}
        </h2>
        <Button variant="secondary" onClick={() => setInviteOpen(true)}>
          Invite guardian
        </Button>
      </div>

      {error ? (
        <p className="mt-3 rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700" role="alert">
          {error}
        </p>
      ) : links === null ? (
        <p className="mt-3 text-sm text-ink-muted" role="status">
          Loading guardians…
        </p>
      ) : links.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">
          No guardians linked to this student yet.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line text-sm">
          {links.map((link) => (
            <li key={link.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {link.guardian.firstName} {link.guardian.lastName}
                  <span className="ml-2 font-normal text-ink-muted">
                    · {link.relationship}
                  </span>
                </p>
                <p className="truncate text-xs text-ink-muted">{link.guardian.email}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Badge tone={link.status === 'ACTIVE' ? 'success' : 'neutral'}>
                  {link.status}
                </Badge>
                {link.status === 'ACTIVE' ? (
                  <Button
                    variant="ghost"
                    onClick={() => void revoke(link.id)}
                    disabled={busyLinkId === link.id}
                  >
                    {busyLinkId === link.id ? 'Revoking…' : 'Revoke'}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {inviteOpen ? (
        <InviteGuardianDialog
          studentProfileId={studentProfileId}
          onClose={() => setInviteOpen(false)}
          onInvited={(email, invite) => {
            setInviteOpen(false);
            load();
            if (invite) {
              setInviteLink({ email, link: invite });
            } else {
              toast(`Guardian linked: ${email}`);
            }
          }}
        />
      ) : null}
      <InviteLinkDialog
        open={inviteLink !== null}
        title="Guardian invitation link"
        description={
          inviteLink ? `Send this link to ${inviteLink.email} to activate their account.` : ''
        }
        link={inviteLink?.link ?? null}
        onClose={() => setInviteLink(null)}
      />
    </section>
  );
}

function InviteGuardianDialog({
  studentProfileId,
  onClose,
  onInvited,
}: {
  studentProfileId: string;
  onClose: () => void;
  onInvited: (email: string, invite: CredentialLinkInfo | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '').trim().toLowerCase();
    const relationship = String(data.get('relationship') ?? '').trim();
    if (!email || !relationship) {
      setError('Email and relationship are required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<{
        invite: CredentialLinkInfo | null;
      }>(`/students/${studentProfileId}/guardians`, {
        method: 'POST',
        body: JSON.stringify({ email, relationship }),
      });
      onInvited(email, response.data.invite);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invitation failed');
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="Invite guardian"
      description="Creates or links a guardian account with read-only access to this student."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input label="Guardian email" name="email" type="email" />
        <Input label="Relationship" name="relationship" placeholder="e.g. Mother" />
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
            {busy ? 'Inviting…' : 'Invite'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
