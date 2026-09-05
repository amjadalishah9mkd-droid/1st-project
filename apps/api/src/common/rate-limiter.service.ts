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
  /**
   * GET /auth/google/callback — per IP (M19-W2). Mirrors googleStart:
   * the caller is unauthenticated, so the source IP is the only stable
   * limiting identity; query params (code/state/error) are attacker-
   * controlled and deliberately NOT part of the key, so varying them
   * cannot bypass the limit. Process-local like every policy here
   * (Blueprint §14 — no Redis); per-instance bound documented in
   * OPERATIONS.md.
   */
  googleCallback: { limit: 60, windowMs: 60_000 },
  /** POST /verification/evidence — per user (disk-fill protection). */
  evidenceUpload: { limit: 15, windowMs: 60 * 60_000 },
  /** POST /verification/claims — per user. */
  claimSubmit: { limit: 10, windowMs: 60 * 60_000 },
  /** POST /files — per user. */
  fileUpload: { limit: 60, windowMs: 60 * 60_000 },
  /** POST /files/sign — per user (one signature per download click). */
  fileSign: { limit: 300, windowMs: 60_000 },
  /** POST /students/:id/guardians — per admin user (M13-W2). */
  guardianInvite: { limit: 20, windowMs: 60 * 60_000 },
} as const;

export type RatePolicyName = keyof typeof RATE_POLICIES;

/** F2: sweep fully-expired buckets at most this often (lazy, in-band). */
const PRUNE_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class RateLimiterService {
  private buckets = new Map<string, number[]>();
  private lastPruneAt = Date.now();

  /** Throws the standard RATE_LIMITED envelope (429) when over policy. */
  assert(policy: RatePolicyName, key: string): void {
    this.maybePrune();
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

  /**
   * F2 (M13-W5): drop buckets whose every hit is outside its policy window.
   * Without this, one-off keys (e.g. per-IP token-endpoint hits) accumulate
   * forever on long uptimes. Runs lazily inside assert() at most once per
   * PRUNE_INTERVAL_MS — no timers, no behavior change for live buckets.
   */
  private maybePrune(now = Date.now()): void {
    if (now - this.lastPruneAt < PRUNE_INTERVAL_MS) return;
    this.prune(now);
  }

  /** Exposed for tests; prunes immediately regardless of the interval. */
  prune(now = Date.now()): void {
    this.lastPruneAt = now;
    for (const [bucketKey, hits] of this.buckets) {
      const policy = bucketKey.slice(
        0,
        bucketKey.indexOf(':'),
      ) as RatePolicyName;
      const windowMs = RATE_POLICIES[policy]?.windowMs ?? 60 * 60_000;
      if (!hits.some((t) => now - t < windowMs)) {
        this.buckets.delete(bucketKey);
      }
    }
  }

  /** Test hook: number of live bucket keys (F2 regression coverage). */
  bucketCount(): number {
    return this.buckets.size;
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
