'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { apiFetch, ApiError } from '@/lib/api/client';

export interface CredentialLinkInfo {
  url: string; // path-only, from the API
  expiresAt: string;
}

/** Turns the API's path-only link into a shareable absolute URL. */
export function toAbsoluteLink(path: string): string {
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

export function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function CopyLinkField({ link }: { link: CredentialLinkInfo }) {
  const [copied, setCopied] = useState(false);
  const absolute = toAbsoluteLink(link.url);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={absolute}
          aria-label="Invite link"
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 font-mono text-xs"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(absolute);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="text-xs text-ink-500">
        One-time link — expires {formatExpiry(link.expiresAt)}. Share it
        securely; it will not be shown again.
      </p>
    </div>
  );
}

export function InviteLinkDialog({
  open,
  title,
  description,
  link,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  link: CredentialLinkInfo | null;
  onClose: () => void;
}) {
  if (!link) return null;
  return (
    <Dialog open={open} title={title} description={description} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <CopyLinkField link={link} />
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * "Issue reset link" action for admin detail pages (M10-W2).
 * Confirms first (it invalidates any previous reset link), then shows the
 * one-time link with a copy button.
 */
export function ResetLinkButton({
  userId,
  personName,
}: {
  userId: string;
  personName: string;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<CredentialLinkInfo | null>(null);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<CredentialLinkInfo>(
        `/users/${userId}/reset-link`,
        { method: 'POST' },
      );
      setConfirmOpen(false);
      setLink(response.data);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to issue reset link',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
        Issue reset link
      </Button>
      <Dialog
        open={confirmOpen}
        title="Issue password reset link?"
        description={`This creates a one-time link that lets ${personName} set a new password. Any previously issued reset link stops working.`}
        onClose={() => setConfirmOpen(false)}
      >
        <div className="flex flex-col gap-4">
          {error ? (
            <p
              className="rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => setConfirmOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={() => void issue()} disabled={busy}>
              {busy ? 'Issuing…' : 'Issue link'}
            </Button>
          </div>
        </div>
      </Dialog>
      <InviteLinkDialog
        open={link !== null}
        title="Password reset link"
        description={`Send this link to ${personName} to set a new password.`}
        link={link}
        onClose={() => setLink(null)}
      />
    </>
  );
}
