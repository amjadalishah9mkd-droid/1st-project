import type { UploadedFileInfo } from '@campusos/shared';
import { getAccessToken } from '../auth/token-store';
import { ApiError } from './client';

/** Uploads one file through POST /api/v1/files (multipart). */
export async function uploadFile(file: File): Promise<UploadedFileInfo> {
  const body = new FormData();
  body.append('file', file);
  const token = getAccessToken();
  const response = await fetch('/api/v1/files', {
    method: 'POST',
    body,
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      json?.error?.code ?? 'UPLOAD_FAILED',
      json?.error?.message ?? 'Upload failed',
      response.status,
    );
  }
  return json.data as UploadedFileInfo;
}
