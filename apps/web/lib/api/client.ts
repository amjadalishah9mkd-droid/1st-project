import type { ApiErrorBody, ApiSuccess } from '@campusos/shared';
import { getAccessToken } from '../auth/token-store';
import { requestRefresh } from '../auth/auth-api';

/**
 * Typed API client base (Blueprint §12 — lib/api).
 * All web → API calls flow through this wrapper so envelope handling, bearer
 * attachment and 401 auto-refresh exist in exactly one place.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const API_BASE = '/api/v1';

async function rawFetch<T>(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const token = getAccessToken();
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    credentials: 'include',
  });
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<ApiSuccess<T>> {
  let response = await rawFetch<T>(path, init);

  // Access token expired mid-session → one silent refresh, then retry once.
  if (response.status === 401 && !path.startsWith('/auth/')) {
    const refreshed = await requestRefresh();
    if (refreshed) {
      response = await rawFetch<T>(path, init);
    }
  }

  const body = (await response.json().catch(() => null)) as
    | ApiSuccess<T>
    | ApiErrorBody
    | null;

  if (!response.ok) {
    if (body && 'error' in body) {
      throw new ApiError(
        body.error.code,
        body.error.message,
        response.status,
        body.error.details,
      );
    }
    throw new ApiError('UNKNOWN', 'Request failed', response.status);
  }

  if (!body || !('data' in body)) {
    throw new ApiError('MALFORMED_RESPONSE', 'Malformed API response', 500);
  }
  return body;
}
