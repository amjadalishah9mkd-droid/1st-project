import type { Response } from 'express';
import type { MePayload } from '@campusos/shared';
import { REFRESH_TOKEN_TTL_MS } from './token.service';

export const REFRESH_COOKIE = 'cos_refresh';
export const SESSION_HINT_COOKIE = 'cos_auth';

/**
 * Cookie strategy (Blueprint §9):
 *  - cos_refresh: the raw refresh token. httpOnly + Secure + SameSite=Lax,
 *    scoped to /api/v1/auth so it is only ever sent to auth endpoints.
 *    Never readable by JavaScript.
 *  - cos_auth: httpOnly routing hint for the Next.js middleware
 *    ({ role, mustChangePassword } only — no tokens, no permissions).
 *    Authorization is always enforced server-side; this cookie only shapes
 *    redirects.
 *
 * Shared by password login (AuthController) and Google OIDC callback
 * (GoogleAuthController) — a single session-issuance path (M11-W2).
 */
export function setAuthCookies(
  res: Response,
  refreshToken: string,
  me: MePayload,
): void {
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
  res.cookie(SESSION_HINT_COOKIE, encodeSessionHint(me), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

export function encodeSessionHint(me: MePayload): string {
  // r: role, mcp: mustChangePassword, v: verificationStatus (M11-W5 —
  // routing hint only; the API enforces the lifecycle server-side).
  return Buffer.from(
    JSON.stringify({
      r: me.role,
      mcp: me.mustChangePassword,
      v: me.verificationStatus,
    }),
  ).toString('base64url');
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  res.clearCookie(SESSION_HINT_COOKIE, { path: '/' });
}
