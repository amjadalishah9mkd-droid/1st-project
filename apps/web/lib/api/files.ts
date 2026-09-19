import type { SignedFileUrl } from '@campusos/shared';
import { apiFetch } from './client';

/**
 * Opens a stored CampusOS file (M10-W1).
 * Stored fileUrl values are unsigned internal URLs; this helper exchanges
 * one for a short-lived signed URL via the authenticated API, then opens it.
 * The signing secret never reaches the browser.
 */
export async function openFile(fileUrl: string): Promise<void> {
  const response = await apiFetch<SignedFileUrl>('/files/sign', {
    method: 'POST',
    body: JSON.stringify({ url: fileUrl }),
  });
  window.open(response.data.url, '_blank', 'noopener');
}
