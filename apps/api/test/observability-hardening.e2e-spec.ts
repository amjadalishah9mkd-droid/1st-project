import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  currentRequestId,
  REQUEST_ID_HEADER,
  runWithRequestId,
} from '../src/common/observability/request-context';
import {
  operationalLogger,
  type OperationalLogRecord,
} from '../src/common/observability/operational-logger';
import {
  OPERATIONAL_COUNTER_NAMES,
  operationalCounters,
} from '../src/common/observability/operational-counters';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * M22-W4 — final observability hardening invariants not already proven by the
 * W1/W2 suites: deep nested-async context propagation, absence of context
 * leakage into background execution, single-line JSON safety, and read-only
 * counter semantics on the protected ops surface.
 */
describe('M22-W4 — observability hardening', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let adminToken: string;
  let lines: string[];

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
    app.get(LoginRateLimiterService).reset();
    const login = await http
      .post('/api/v1/auth/login')
      .send({ email: 'admin@campusos.dev', password: DEMO_PASSWORD });
    expect(login.status).toBe(200);
    adminToken = login.body.data.accessToken as string;
  });

  beforeEach(() => {
    lines = [];
    operationalLogger.setSink((line) => lines.push(line));
  });

  afterEach(async () => {
    await settle();
    operationalLogger.resetSink();
  });

  afterAll(async () => {
    operationalLogger.resetSink();
    operationalCounters.reset();
    await app.close();
  });

  const records = (): OperationalLogRecord[] =>
    lines.map((line) => JSON.parse(line) as OperationalLogRecord);

  it('propagates the request context through deeply nested asynchronous work', async () => {
    const observed = await runWithRequestId('nested-async-id', async () => {
      await Promise.resolve();
      const afterAwait = currentRequestId();
      const afterTimer = await new Promise<string | undefined>((resolve) =>
        setTimeout(() => resolve(currentRequestId()), 5),
      );
      const afterFanOut = await Promise.all([
        (async () => {
          await new Promise((resolve) => setImmediate(resolve));
          return currentRequestId();
        })(),
        (async () => {
          await new Promise((resolve) => setTimeout(resolve, 3));
          return currentRequestId();
        })(),
      ]);
      return [afterAwait, afterTimer, ...afterFanOut];
    });
    expect(observed).toEqual([
      'nested-async-id',
      'nested-async-id',
      'nested-async-id',
      'nested-async-id',
    ]);
  });

  it('never leaks request context into unrelated background execution', async () => {
    runWithRequestId('background-probe', () => {
      expect(currentRequestId()).toBe('background-probe');
    });
    expect(currentRequestId()).toBeUndefined();

    const detached = await new Promise<string | undefined>((resolve) =>
      setTimeout(() => resolve(currentRequestId()), 5),
    );
    expect(detached).toBeUndefined();

    // A background operational event outside any request omits requestId
    // entirely rather than reusing a previous request's identifier.
    const record = operationalLogger.write({
      level: 'info',
      event: 'request.completed',
      method: 'GET',
      route: '/background/task',
      statusCode: 200,
    });
    expect(record).not.toHaveProperty('requestId');
  });

  it('emits exactly one valid single-line JSON record per operational event', async () => {
    const res = await http
      .get('/api/v1/me')
      .set(REQUEST_ID_HEADER, 'single-line-json');
    expect(res.status).toBe(401);
    await settle();

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toMatch(/[\r\n]/);
      expect(() => JSON.parse(line)).not.toThrow();
    }
    expect(
      records().filter((record) => record.event === 'request.completed'),
    ).toHaveLength(1);
  });

  it('treats protected ops health as read-only for counters', async () => {
    operationalCounters.reset();
    const baseline = operationalCounters.snapshot();

    const first = await http
      .get('/api/v1/health/ops')
      .set({ Authorization: `Bearer ${adminToken}` });
    expect(first.status).toBe(200);
    await settle();
    const second = await http
      .get('/api/v1/health/ops')
      .set({ Authorization: `Bearer ${adminToken}` });
    expect(second.status).toBe(200);
    await settle();

    // resetAt is stable across reads: reading never restarts the window.
    expect(second.body.data.runtime.resetAt).toBe(baseline.resetAt);
    expect(first.body.data.runtime.resetAt).toBe(baseline.resetAt);
    // Counters only ever advance through real traffic, never backwards.
    expect(second.body.data.runtime.counters.requestsCompleted).toBeGreaterThan(
      first.body.data.runtime.counters.requestsCompleted,
    );
    expect(Object.keys(second.body.data.runtime.counters).sort()).toEqual(
      [...OPERATIONAL_COUNTER_NAMES].sort(),
    );
  });
});
