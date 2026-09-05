import type { AuthPayload } from '@campusos/shared';
import { setAccessToken } from './token-store';

/**
 * Auth API calls that bypass the auto-refresh wrapper (they ARE the refresh
 * machinery). Refresh relies solely on the httpOnly cookie.
 *
 * Refresh is single-flight: concurrent callers (e.g. React strict-mode
 * double effects, parallel 401 retries) share one in-flight rotation.
 * Firing two refreshes with the same cookie would otherwise trip the
 * server's reuse detection and revoke the whole token family.
 */
let inflightRefresh: Promise<AuthPayload | null> | null = null;

export function requestRefresh(): Promise<AuthPayload | null> {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async () => {
    try {
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
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

export async function requestLogout(): Promise<void> {
  await fetch('/api/v1/auth/logout', {
    method: 'POST',
    credentials: 'include',
  }).catch(() => undefined);
  setAccessToken(null);
}
