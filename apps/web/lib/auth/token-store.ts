/**
 * In-memory access-token store (Blueprint §9).
 * The access JWT lives ONLY in this module-scoped variable — never in
 * localStorage, sessionStorage, or a readable cookie. A page reload drops it;
 * the session is restored via the httpOnly refresh cookie.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}
