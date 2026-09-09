import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';

/**
 * M11-W2 — Google OIDC network client.
 *
 * DI boundary for tests: e2e suites override GOOGLE_OIDC_CLIENT with a fake
 * that returns arbitrary claim payloads, so claim validation in
 * GoogleAuthService is exercised against real code without live Google.
 *
 * This real implementation:
 *  - exchanges the authorization code at Google's token endpoint (server
 *    side, client secret never leaves the API)
 *  - verifies the RS256 signature of the returned id_token against Google's
 *    JWKS (cached, with rotation handling: refetch on unknown kid)
 *  - returns the RAW payload; semantic claim validation (iss/aud/exp/nonce/
 *    email_verified) is done by GoogleAuthService.
 *
 * Never logs codes, tokens or secrets.
 */
export const GOOGLE_OIDC_CLIENT = Symbol('GOOGLE_OIDC_CLIENT');

export interface GoogleOidcClient {
  exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<Record<string, unknown>>;
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
const JWKS_MIN_REFETCH_MS = 5 * 60 * 1000;

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

function oidcFailure(): UnauthorizedException {
  // Generic by design — details are not actionable for legitimate users and
  // are useful to attackers.
  return new UnauthorizedException({
    code: 'GOOGLE_AUTH_FAILED',
    message: 'Google sign-in could not be completed. Please try again.',
  });
}

@Injectable()
export class HttpGoogleOidcClient implements GoogleOidcClient {
  private jwks = new Map<string, Jwk>();
  private jwksFetchedAt = 0;

  async exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<Record<string, unknown>> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw oidcFailure();

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    }).catch(() => null);
    if (!response || !response.ok) throw oidcFailure();

    const body = (await response.json().catch(() => null)) as {
      id_token?: string;
    } | null;
    const idToken = body?.id_token;
    if (!idToken) throw oidcFailure();

    return this.verifySignatureAndDecode(idToken);
  }

  private async verifySignatureAndDecode(
    idToken: string,
  ): Promise<Record<string, unknown>> {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw oidcFailure();
    const [headerB64, payloadB64, signatureB64] = parts;

    let header: { alg?: string; kid?: string };
    let payload: Record<string, unknown>;
    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
      payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      );
    } catch {
      throw oidcFailure();
    }
    if (header.alg !== 'RS256' || !header.kid) throw oidcFailure();

    const jwk = await this.keyForKid(header.kid);
    if (!jwk) throw oidcFailure();

    const key = createPublicKey({ key: jwk as never, format: 'jwk' });
    const valid = cryptoVerify(
      'RSA-SHA256',
      Buffer.from(`${headerB64}.${payloadB64}`),
      key,
      Buffer.from(signatureB64, 'base64url'),
    );
    if (!valid) throw oidcFailure();
    return payload;
  }

  /** JWKS cache with rotation handling: unknown kid triggers a refetch. */
  private async keyForKid(kid: string): Promise<Jwk | undefined> {
    if (
      !this.jwks.has(kid) &&
      Date.now() - this.jwksFetchedAt > JWKS_MIN_REFETCH_MS
    ) {
      await this.fetchJwks();
    }
    if (!this.jwks.has(kid) && this.jwks.size === 0) {
      await this.fetchJwks();
    }
    return this.jwks.get(kid);
  }

  private async fetchJwks(): Promise<void> {
    const response = await fetch(JWKS_URI).catch(() => null);
    if (!response || !response.ok) return;
    const body = (await response.json().catch(() => null)) as {
      keys?: Jwk[];
    } | null;
    if (!body?.keys) return;
    this.jwks = new Map(body.keys.filter((k) => k.kid).map((k) => [k.kid, k]));
    this.jwksFetchedAt = Date.now();
  }
}
