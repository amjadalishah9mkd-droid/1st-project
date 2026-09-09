export const OPERATIONAL_COUNTER_NAMES = [
  'requestsCompleted',
  'responses4xx',
  'responses5xx',
  'known5xx',
  'unexpected5xx',
  'rateLimitRejections',
] as const;

export type OperationalCounterName =
  (typeof OPERATIONAL_COUNTER_NAMES)[number];

export interface OperationalCounterSnapshot {
  scope: 'instance';
  resetAt: string;
  values: Record<OperationalCounterName, number>;
}

/**
 * M22-W2 — bounded process-local counters. There is no arbitrary increment
 * API and no labels: only the six compile-time names above can exist, so
 * attacker-controlled paths, IDs, codes or identities can never create
 * cardinality. State resets naturally on process restart and is never stored
 * in Postgres, AuditLog, Redis or an external service.
 */
export class OperationalCounters {
  private resetTime = new Date();
  private values = this.zeroValues();

  recordResponse(statusCode: number): void {
    this.values.requestsCompleted += 1;
    if (statusCode >= 400 && statusCode < 500) {
      this.values.responses4xx += 1;
    } else if (statusCode >= 500) {
      this.values.responses5xx += 1;
    }
    if (statusCode === 429) this.values.rateLimitRejections += 1;
  }

  recordServerError(unexpected: boolean): void {
    if (unexpected) this.values.unexpected5xx += 1;
    else this.values.known5xx += 1;
  }

  snapshot(): OperationalCounterSnapshot {
    return {
      scope: 'instance',
      resetAt: this.resetTime.toISOString(),
      values: { ...this.values },
    };
  }

  /** Test/diagnostic hook; there is deliberately no HTTP reset endpoint. */
  reset(): void {
    this.resetTime = new Date();
    this.values = this.zeroValues();
  }

  private zeroValues(): Record<OperationalCounterName, number> {
    return {
      requestsCompleted: 0,
      responses4xx: 0,
      responses5xx: 0,
      known5xx: 0,
      unexpected5xx: 0,
      rateLimitRejections: 0,
    };
  }
}

export const operationalCounters = new OperationalCounters();
