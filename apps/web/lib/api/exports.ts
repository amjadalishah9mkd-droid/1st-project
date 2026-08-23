import { getAccessToken } from '../auth/token-store';
import { ApiError } from './client';

/**
 * M12-W3 — CSV export download helper.
 * Bearer-authenticated fetch → blob → anchor click (same auth pattern as
 * the CSV import upload). Errors arrive as the standard JSON envelope.
 */
export async function downloadCsv(path: string, filename: string): Promise<void> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? 'Export failed',
      response.status,
    );
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
