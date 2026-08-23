import { Global, HttpException, HttpStatus, Injectable, Module } from '@nestjs/common';

/**
 * M11-W7 — general request rate limiter with named, testable policies.
 *
 * Same engine philosophy as the M1 LoginRateLimiterService (which remains
 * unchanged for failed-login backoff): fixed windows, in-memory buckets —
 * deliberate per Blueprint §14 (no Redis). In a horizontally scaled
 * deployment each instance enforces the policy independently, bounding
 * total abuse at policy × instances; documented in OPERATIONS.md.
 *
 * Policies are declared here, in one place, and asserted by controllers via
 * assert(policy, key). Keys are per-user for authenticated endpoints and
 * per-IP for public ones.
 */
export const RATE_POLICIES = {
  /** Public invite/reset token endpoints — per IP. */
  tokenEndpoints: { limit: 30, windowMs: 60_000 },
  /** GET /auth/invite-info — per IP. */
  inviteInfo: { limit: 30, windowMs: 60_000 },
  /** GET /auth/google/start — per IP. */
  googleStart: { limit: 60, windowMs: 60_000 },
  /** POST /verification/evidence — per user (disk-fill protection). */
  evidenceUpload: { limit: 15, windowMs: 60 * 60_000 },
  /** POST /verification/claims — per user. */
  claimSubmit: { limit: 10, windowMs: 60 * 60_000 },
  /** POST /files — per user. */
  fileUpload: { limit: 60, windowMs: 60 * 60_000 },
  /** POST /files/sign — per user (one signature per download click). */
  fileSign: { limit: 300, windowMs: 60_000 },
} as const;

export type RatePolicyName = keyof typeof RATE_POLICIES;

@Injectable()
export class RateLimiterService {
  private buckets = new Map<string, number[]>();

  /** Throws the standard RATE_LIMITED envelope (429) when over policy. */
  assert(policy: RatePolicyName, key: string): void {
    const { limit, windowMs } = RATE_POLICIES[policy];
    const now = Date.now();
    const bucketKey = `${policy}:${key}`;
    const hits = (this.buckets.get(bucketKey) ?? []).filter(
      (t) => now - t < windowMs,
    );
    if (hits.length >= limit) {
      this.buckets.set(bucketKey, hits);
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Too many attempts. Please try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    hits.push(now);
    this.buckets.set(bucketKey, hits);
  }

  /** Test hook (mirrors LoginRateLimiterService.reset). */
  reset(): void {
    this.buckets.clear();
  }
}

@Global()
@Module({
  providers: [RateLimiterService],
  exports: [RateLimiterService],
})
export class RateLimitModule {}
