'use client';

import { useState } from 'react';
import type { PermissionKey } from '@campusos/shared';
import { Button } from '@/components/ui/button';
import { useSession } from '@/components/providers/session-provider';
import { useToast } from '@/components/providers/toast-provider';
import { downloadCsv } from '@/lib/api/exports';
import { ApiError } from '@/lib/api/client';

/**
 * M12-W3 — CSV export button (decision A3: exports are ALL-scope only).
 * Visibility mirrors the server rule by checking the caller's resolved
 * grant scope; the API remains the enforcement point regardless.
 */
export function ExportCsvButton({
  permission,
  path,
  filename,
  label = 'Export CSV',
}: {
  permission: PermissionKey;
  path: string;
  filename: string;
  label?: string;
}) {
  const { user } = useSession();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const allowed = user?.permissions.some(
    (grant) => grant.key === permission && grant.scope === 'ALL',
  );
  if (!allowed) return null;

  async function handleClick() {
    setBusy(true);
    try {
      await downloadCsv(path, filename);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Export failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" onClick={() => void handleClick()} disabled={busy}>
      {busy ? 'Exporting…' : label}
    </Button>
  );
}
