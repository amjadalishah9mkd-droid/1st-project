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
 * Login rate limiter (Blueprint §9): 5 failed attempts per minute, tracked
 * per IP AND per account, with exponential backoff on repeat violations
 * (1m → 2m → 4m … capped at 15m). Successful login clears the account
 * counter. In-memory by design for the MVP (no Redis — Blueprint §14).
 */
@Injectable()
export class LoginRateLimiterService {
  private readonly buckets = new Map<string, WindowState>();

  /** Throws 429 when the IP or account is currently blocked. */
  assertAllowed(ip: string, email: string): void {
    const now = Date.now();
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

  /** Test hook: clears all limiter state. */
  reset(): void {
    this.buckets.clear();
  }
}
