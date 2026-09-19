import { ArgumentsHost, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HealthController } from '../src/health/health.controller';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import {
  OperationalCounters,
  OPERATIONAL_COUNTER_NAMES,
  operationalCounters,
} from '../src/common/observability/operational-counters';
import { runWithRequestId } from '../src/common/observability/request-context';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * M22-W2 — truthful readiness + bounded instance-local counters.
 * E2E cases use the real middleware/filter/auth stack and real Postgres.
 * Controller isolation is used only to model an unavailable DB without
 * taking down the shared test database used by the other 631 tests.
 */
describe('M22-W2 — runtime reliability', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let adminToken: string;
  let studentToken: string;

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const response = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(response.status).toBe(200);
    return response.body.data.accessToken as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
    adminToken = await login('admin@campusos.dev');
    studentToken = await login('student@campusos.dev');
  });

  beforeEach(() => {
    operationalCounters.reset();
  });

  afterAll(async () => {
    operationalCounters.reset();
    await app.close();
  });

  it('reports truthful healthy readiness on /health and /health/ready', async () => {
    for (const path of ['/api/v1/health', '/api/v1/health/ready']) {
      const response = await http
        .get(path)
        .set('x-request-id', 'readiness-healthy');
      expect(response.status).toBe(200);
      expect(response.headers['x-request-id']).toBe('readiness-healthy');
      expect(response.body.data).toMatchObject({
        status: 'ok',
        service: 'campusos-api',
        database: 'up',
      });
    }
  });

  it('returns 503/degraded when the required database dependency is down', async () => {
    const fakePrisma = { isHealthy: jest.fn().mockResolvedValue(false) };
    const controller = new HealthController(fakePrisma as never);
    const status = jest.fn();
    const response = { status } as never;

    const body = await controller.readiness(response);
    expect(fakePrisma.isHealthy).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(503);
    expect(body).toMatchObject({ status: 'degraded', database: 'down' });
    expect(JSON.stringify(body)).not.toContain('postgresql://');
  });

  it('keeps liveness process-only and independent of the database', () => {
    const fakePrisma = { isHealthy: jest.fn() };
    const controller = new HealthController(fakePrisma as never);
    const body = controller.liveness();
    expect(body).toMatchObject({ status: 'ok', service: 'campusos-api' });
    expect(body).not.toHaveProperty('database');
    expect(fakePrisma.isHealthy).not.toHaveBeenCalled();
  });

  it('exposes liveness publicly with request correlation intact', async () => {
    const response = await http
      .get('/api/v1/health/live')
      .set('x-request-id', 'liveness-check');
    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe('liveness-check');
    expect(response.body.data.status).toBe('ok');
    expect(response.body.data).not.toHaveProperty('database');
  });

  it('uses a fixed counter allowlist and starts/reset at zero', () => {
    const fresh = new OperationalCounters().snapshot();
    expect(fresh.scope).toBe('instance');
    expect(Object.keys(fresh.values).sort()).toEqual(
      [...OPERATIONAL_COUNTER_NAMES].sort(),
    );
    expect(Object.values(fresh.values)).toEqual([0, 0, 0, 0, 0, 0]);

    operationalCounters.recordResponse(404);
    operationalCounters.recordServerError(true);
    operationalCounters.reset();
    expect(Object.values(operationalCounters.snapshot().values)).toEqual([
      0, 0, 0, 0, 0, 0,
    ]);
  });

  it('classifies real completion/error paths exactly once without mixing 4xx/5xx', async () => {
    operationalCounters.reset();
    expect((await http.get('/api/v1/auth/config')).status).toBe(200);
    expect((await http.get('/api/v1/me')).status).toBe(401);
    expect(
      (
        await http.get(
          '/api/v1/auth/google/callback?code=secret&state=secret',
        )
      ).status,
    ).toBe(503);
    await settle();

    expect(operationalCounters.snapshot().values).toEqual({
      requestsCompleted: 3,
      responses4xx: 1,
      responses5xx: 1,
      known5xx: 1,
      unexpected5xx: 0,
      rateLimitRejections: 0,
    });
  });

  it('classifies unexpected 5xx once without attacker labels', () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({
          method: 'POST',
          route: { path: '/safe/:id' },
        }),
      }),
    } as unknown as ArgumentsHost;
    runWithRequestId('unexpected-counter', () => {
      new GlobalExceptionFilter().catch(
        new Error('secret@example.com token=never-counted'),
        host,
      );
    });
    expect(operationalCounters.snapshot().values).toEqual({
      requestsCompleted: 0, // no HTTP completion in this isolated filter test
      responses4xx: 0,
      responses5xx: 0,
      known5xx: 0,
      unexpected5xx: 1,
      rateLimitRejections: 0,
    });
    expect(Object.keys(operationalCounters.snapshot().values)).toEqual(
      expect.arrayContaining([...OPERATIONAL_COUNTER_NAMES]),
    );
  });

  it('counts 429 in the fixed rejection bucket with no policy/user/IP labels', () => {
    operationalCounters.recordResponse(429);
    const snapshot = operationalCounters.snapshot();
    expect(snapshot.values.requestsCompleted).toBe(1);
    expect(snapshot.values.responses4xx).toBe(1);
    expect(snapshot.values.rateLimitRejections).toBe(1);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /userId|collegeId|email|token|ip|route|policy/,
    );
  });

  it('does not lose increments under concurrent request completions', async () => {
    operationalCounters.reset();
    const ids = Array.from({ length: 20 }, (_, index) => `counter-${index}`);
    await Promise.all(
      ids.map(async (id) => {
        await Promise.resolve();
        operationalCounters.recordResponse(id.endsWith('0') ? 500 : 200);
      }),
    );
    const values = operationalCounters.snapshot().values;
    expect(values.requestsCompleted).toBe(20);
    expect(values.responses5xx).toBe(2); // counter-0 and counter-10
    expect(values.responses4xx).toBe(0);
  });

  it('keeps /health/ops protected and exposes only aggregate instance state', async () => {
    operationalCounters.reset();
    const anonymous = await http.get('/api/v1/health/ops');
    expect(anonymous.status).toBe(401);
    const forbidden = await http
      .get('/api/v1/health/ops')
      .set({ Authorization: `Bearer ${studentToken}` });
    expect(forbidden.status).toBe(403);

    const response = await http
      .get('/api/v1/health/ops')
      .set({ Authorization: `Bearer ${adminToken}` });
    expect(response.status).toBe(200);
    expect(response.body.data.migrations.status).toBe('ok');
    expect(response.body.data.runtime.scope).toBe('instance');
    expect(Object.keys(response.body.data.runtime.counters).sort()).toEqual(
      [...OPERATIONAL_COUNTER_NAMES].sort(),
    );
    // Snapshot is taken before this ops response's own finish event: it sees
    // the two preceding authorization failures exactly.
    expect(response.body.data.runtime.counters.responses4xx).toBe(2);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toMatch(
      /postgresql:\/\/|password|email|token|userId|collegeId|route|ip/i,
    );
  });
});
