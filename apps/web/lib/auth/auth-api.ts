import type { AuthPayload } from '@campusos/shared';
import { setAccessToken } from './token-store';

/**
 * Auth API calls that bypass the auto-refresh wrapper (they ARE the refresh
 * machinery). Refresh relies solely on the httpOnly cookie.
 */
export async function requestRefresh(): Promise<AuthPayload | null> {
  const response = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    setAccessToken(null);
    return null;
  }
  const body = (await response.json()) as { data: AuthPayload };
  setAccessToken(body.data.accessToken);
  return body.data;
}

export async function requestLogout(): Promise<void> {
  await fetch('/api/v1/auth/logout', {
    method: 'POST',
    credentials: 'include',
  }).catch(() => undefined);
  setAccessToken(null);
}
