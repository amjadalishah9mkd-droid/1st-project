'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api/client';
import { useSession } from '@/components/providers/session-provider';
import { useToast } from '@/components/providers/toast-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatDateTime } from '@/lib/format';

/**
 * M21-W3 — account lifecycle controls (presentation only).
 * The W1 backend is authoritative: users.manage authorization, tenancy,
 * CAS transitions, self/last-admin protection and audit all live server
 * side. This card only shows the current status, the reason/date metadata
 * the API already authorized, and the actions valid FROM the current
 * status (ARCHIVED is terminal — no actions). Errors are surfaced verbatim
 * through the standard toast conventions.
 */
export function AccountLifecycleCard({
  userId,
  userStatus,
  statusReason,
  statusChangedAt,
  onChanged,
}: {
  userId: string;
  userStatus: string;
  statusReason: string | null;
  statusChangedAt: string | null;
  onChanged: () => void;
}) {
  const { hasPermission } = useSession();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<'suspend' | 'archive' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const canManage = hasPermission('users.manage'); // visibility HINT only
  if (!canManage) return null;

  async function act(verb: 'suspend' | 'reactivate' | 'archive') {
    setBusy(true);
    try {
      await apiFetch(`/users/${userId}/${verb}`, {
        method: 'POST',
        body:
          verb === 'reactivate'
            ? JSON.stringify({})
            : JSON.stringify({ reason: reason.trim() }),
      });
      toast(
        verb === 'suspend'
          ? 'Account suspended — active sessions were revoked'
          : verb === 'reactivate'
            ? 'Account reactivated'
            : 'Account archived permanently',
      );
      setDialog(null);
      setReason('');
      onChanged();
    } catch (err) {
      toast(
        err instanceof ApiError ? err.message : 'Request failed',
        'error',
      );
    } finally {
      setBusy(false);
    }
  }

  const tone =
    userStatus === 'ACTIVE'
      ? 'success'
      : userStatus === 'SUSPENDED'
        ? 'warning'
        : 'danger';

  return (
    <section className="mt-4 rounded-card border border-line bg-surface-raised p-5 shadow-card">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Account status</h2>
          <p className="mt-1 flex items-center gap-2 text-sm">
            <Badge tone={tone as never}>{userStatus}</Badge>
            {statusChangedAt ? (
              <span className="text-xs text-ink-muted">
                changed {formatDateTime(statusChangedAt)}
              </span>
            ) : null}
          </p>
          {statusReason ? (
            <p className="mt-1 text-xs text-ink-muted">
              Reason: {statusReason}
            </p>
          ) : null}
          {userStatus === 'ARCHIVED' ? (
            <p className="mt-1 text-xs text-danger-700">
              Archived accounts are permanent and cannot be reactivated.
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {userStatus === 'ACTIVE' ? (
            <Button variant="secondary" onClick={() => setDialog('suspend')}>
              Suspend
            </Button>
          ) : null}
          {userStatus === 'SUSPENDED' ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => act('reactivate')}
            >
              Reactivate
            </Button>
          ) : null}
          {userStatus === 'ACTIVE' || userStatus === 'SUSPENDED' ? (
            <Button variant="danger" onClick={() => setDialog('archive')}>
              Archive
            </Button>
          ) : null}
        </div>
      </div>

      <Dialog
        open={dialog === 'suspend'}
        title="Suspend account"
        description="The account is locked out immediately and all active sessions are revoked. It can be reactivated later."
        onClose={() => setDialog(null)}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void act('suspend');
          }}
        >
          <Input
            label="Reason (required, min 5 characters)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={5}
            maxLength={500}
            required
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || reason.trim().length < 5}>
              Suspend account
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={dialog === 'archive'}
        title="Archive account permanently"
        description="ARCHIVED IS PERMANENT. The account is locked out immediately, all sessions are revoked, and it can never be reactivated through the application. Records issued to this user are retained."
        onClose={() => setDialog(null)}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void act('archive');
          }}
        >
          <Input
            label="Reason (required, min 5 characters)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={5}
            maxLength={500}
            required
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={busy || reason.trim().length < 5}
            >
              Archive permanently
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
