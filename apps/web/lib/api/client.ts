import type { ApiErrorBody, ApiSuccess } from '@campusos/shared';

/**
 * Typed API client base (Blueprint §12 — lib/api).
 * All web → API calls flow through this wrapper so envelope handling and
 * error normalization exist in exactly one place. Auth/session handling is
 * layered on in M1.
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

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<ApiSuccess<T>> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
    credentials: 'include',
  });

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
