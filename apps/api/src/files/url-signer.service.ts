import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export const DEFAULT_TTL_SECONDS = 5 * 60;

/**
 * HMAC signer for expiring file-download URLs (M10-W1).
 * Signature = HMAC_SHA256(`${key}|${exp}`, FILE_URL_SECRET).
 * The secret lives only in the API environment — never in the browser.
 */
@Injectable()
export class FileUrlSignerService {
  private readonly secret: string;

  constructor() {
    const secret = process.env.FILE_URL_SECRET;
    if (!secret) {
      throw new Error(
        'FILE_URL_SECRET is not set. Run .alloy/populate-env.sh (dev) or configure the environment (production).',
      );
    }
    this.secret = secret;
  }

  private signature(key: string, exp: number): string {
    return createHmac('sha256', this.secret)
      .update(`${key}|${exp}`)
      .digest('hex');
  }

  sign(key: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): {
    exp: number;
    sig: string;
  } {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    return { exp, sig: this.signature(key, exp) };
  }

  /** Timing-safe verification; false for malformed, tampered or expired input. */
  verify(key: string, expRaw: string, sigRaw: string): boolean {
    const exp = Number(expRaw);
    if (!Number.isInteger(exp)) return false;
    if (exp < Math.floor(Date.now() / 1000)) return false;
    const expected = Buffer.from(this.signature(key, exp), 'hex');
    let provided: Buffer;
    try {
      provided = Buffer.from(sigRaw, 'hex');
    } catch {
      return false;
    }
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(provided, expected);
  }

  /** True only when the expiry has passed but the signature was otherwise valid. */
  isExpired(key: string, expRaw: string, sigRaw: string): boolean {
    const exp = Number(expRaw);
    if (!Number.isInteger(exp) || exp >= Math.floor(Date.now() / 1000)) {
      return false;
    }
    const expected = Buffer.from(this.signature(key, exp), 'hex');
    let provided: Buffer;
    try {
      provided = Buffer.from(sigRaw, 'hex');
    } catch {
      return false;
    }
    return (
      provided.length === expected.length && timingSafeEqual(provided, expected)
    );
  }
}
