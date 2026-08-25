import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

interface WindowState {
  failures: number[];
  blockedUntil: number;
  strikes: number; // escalation counter for backoff
}

const WINDOW_MS = 60_000;
const MAX_FAILURES = 5;
const BASE_BLOCK_MS = 60_000;
const MAX_BLOCK_MS = 15 * 60_000;
/**
 * M14-W0 (P2-AUTH-1): sweep fully-expired buckets at most this often,
 * mirroring the F2 fix in RateLimiterService. A bucket is dead once it has
 * no failures inside the window AND its block has lapsed — attacker-cycled
 * emails/IPs no longer accumulate forever. Lazy and in-band: no timers.
 */
const PRUNE_INTERVAL_MS = 5 * 60_000;

/**
 * Login rate limiter (Blueprint §9): 5 failed attempts per minute, tracked
 * per IP AND per account, with exponential backoff on repeat violations
 * (1m → 2m → 4m … capped at 15m). Successful login clears the account
 * counter. In-memory by design for the MVP (no Redis — Blueprint §14).
 */
@Injectable()
export class LoginRateLimiterService {
  private readonly buckets = new Map<string, WindowState>();
  private lastPruneAt = Date.now();

  /** Throws 429 when the IP or account is currently blocked. */
  assertAllowed(ip: string, email: string): void {
    const now = Date.now();
    this.maybePrune(now);
    for (const key of [`ip:${ip}`, `acct:${email}`]) {
      const state = this.buckets.get(key);
      if (state && state.blockedUntil > now) {
        throw new HttpException(
          {
            code: 'RATE_LIMITED',
            message: 'Too many attempts. Please try again later.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  recordFailure(ip: string, email: string): void {
    const now = Date.now();
    for (const key of [`ip:${ip}`, `acct:${email}`]) {
      const state = this.buckets.get(key) ?? {
        failures: [],
        blockedUntil: 0,
        strikes: 0,
      };
      state.failures = state.failures.filter((t) => now - t < WINDOW_MS);
      state.failures.push(now);
      if (state.failures.length >= MAX_FAILURES) {
        state.strikes += 1;
        const blockMs = Math.min(
          BASE_BLOCK_MS * 2 ** (state.strikes - 1),
          MAX_BLOCK_MS,
        );
        state.blockedUntil = now + blockMs;
        state.failures = [];
      }
      this.buckets.set(key, state);
    }
  }

  recordSuccess(email: string): void {
    this.buckets.delete(`acct:${email}`);
  }

  /**
   * P2-AUTH-1: lazy sweep, at most once per PRUNE_INTERVAL_MS, invoked
   * in-band from assertAllowed. Live buckets (recent failures or an
   * unexpired block) are never touched; `strikes` on dead buckets are
   * forgotten, which matches the pre-existing behavior of a successful
   * login clearing the account bucket entirely.
   */
  private maybePrune(now: number): void {
    if (now - this.lastPruneAt < PRUNE_INTERVAL_MS) return;
    this.prune(now);
  }

  /** Exposed for tests; prunes immediately regardless of the interval. */
  prune(now = Date.now()): void {
    this.lastPruneAt = now;
    for (const [key, state] of this.buckets) {
      const hasLiveFailures = state.failures.some((t) => now - t < WINDOW_MS);
      const blocked = state.blockedUntil > now;
      if (!hasLiveFailures && !blocked) {
        this.buckets.delete(key);
      }
    }
  }

  /** Test hook: number of live bucket keys (P2-AUTH-1 regression). */
  bucketCount(): number {
    return this.buckets.size;
  }

  /** Test hook: clears all limiter state. */
  reset(): void {
    this.buckets.clear();
  }
}
