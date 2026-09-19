import { ArgumentsHost, INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  currentRequestId,
  effectiveRequestId,
  REQUEST_ID_HEADER,
  runWithRequestId,
} from '../src/common/observability/request-context';
import {
  operationalLogger,
  type OperationalLogRecord,
} from '../src/common/observability/operational-logger';
import { createTestApp } from './test-app';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * M22-W1 — request correlation and safe operational logging.
 * Exercises the real middleware/filter stack; no auth, tenant or envelope
 * behavior is mocked. Direct helper tests cover hostile header values Node's
 * HTTP client correctly refuses to transmit (CR/LF and controls).
 */
describe('M22-W1 — request correlation & operational logging', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let lines: string[];

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
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
    await app.close();
  });

  function records(): OperationalLogRecord[] {
    return lines.map((line) => JSON.parse(line) as OperationalLogRecord);
  }

  it('every response receives a generated effective request ID', async () => {
    const res = await http.get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.headers[REQUEST_ID_HEADER]).toMatch(UUID);
    // Existing response body contract is unchanged (header only, O-9).
    expect(res.body.data).not.toHaveProperty('requestId');
  });

  it('accepts a strictly valid incoming ID and returns it unchanged', async () => {
    const id = 'edge-proxy.req_2026-09-01';
    const res = await http
      .get('/api/v1/me')
      .set(REQUEST_ID_HEADER, id);
    expect(res.status).toBe(401);
    expect(res.headers[REQUEST_ID_HEADER]).toBe(id);
    expect(res.body.error).not.toHaveProperty('requestId');
  });

  it('replaces oversized and syntactically valid hostile IDs safely', async () => {
    for (const hostile of [
      'a'.repeat(129),
      'quote"break',
      'json{break}',
      'has space',
    ]) {
      const res = await http
        .get('/api/v1/me')
        .set(REQUEST_ID_HEADER, hostile);
      expect(res.headers[REQUEST_ID_HEADER]).toMatch(UUID);
      expect(res.headers[REQUEST_ID_HEADER]).not.toBe(hostile);
    }
  });

  it('replaces CR/LF, controls, Unicode, arrays and empty IDs (header boundary)', () => {
    for (const hostile of [
      'line\r\nbreak',
      'nul\0byte',
      'tab\tvalue',
      'unicode-☃',
      '',
      ['one', 'two'],
      undefined,
    ]) {
      expect(effectiveRequestId(hostile)).toMatch(UUID);
    }
  });

  it('keeps AsyncLocalStorage contexts isolated across concurrent work', async () => {
    const values = await Promise.all(
      Array.from({ length: 30 }, (_, index) => {
        const id = `concurrent-${index}`;
        return runWithRequestId(id, async () => {
          await new Promise((resolve) =>
            setTimeout(resolve, (29 - index) % 7),
          );
          return currentRequestId();
        });
      }),
    );
    expect(values).toEqual(
      Array.from({ length: 30 }, (_, index) => `concurrent-${index}`),
    );
    expect(currentRequestId()).toBeUndefined(); // no context leak to caller
  });

  it('correlates concurrent HTTP completions without ID leakage', async () => {
    const ids = ['http-a', 'http-b'];
    const responses = await Promise.all(
      ids.map((id) =>
        http.get('/api/v1/auth/config').set(REQUEST_ID_HEADER, id),
      ),
    );
    expect(responses.map((res) => res.headers[REQUEST_ID_HEADER])).toEqual(ids);
    await settle();
    const completionIds = records()
      .filter((record) => record.event === 'request.completed')
      .map((record) => record.requestId);
    expect(completionIds.sort()).toEqual([...ids].sort());
  });

  it('emits fixed-schema logs without bodies, headers, query values or tokens', async () => {
    const sentinel = 'VERY-SECRET-TOKEN-987654';
    const id = 'safe-correlation-id';
    const res = await http
      .get(`/api/v1/me?oauth_code=${sentinel}&email=person@example.com`)
      .set(REQUEST_ID_HEADER, id)
      .set('Authorization', `Bearer ${sentinel}`)
      .set('Cookie', `campusos_refresh=${sentinel}`)
      .set('User-Agent', sentinel);
    expect(res.status).toBe(401);
    await settle();

    expect(lines.length).toBeGreaterThan(0);
    const serialized = lines.join('\n');
    expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toContain('person@example.com');
    expect(serialized).not.toContain('oauth_code');
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('Cookie');

    const allowed = new Set([
      'timestamp',
      'level',
      'service',
      'environment',
      'event',
      'requestId',
      'method',
      'route',
      'statusCode',
      'durationMs',
      'errorCode',
      'errorClass',
      'message',
    ]);
    for (const record of records()) {
      expect(Object.keys(record).every((key) => allowed.has(key))).toBe(true);
      expect(record.service).toBe('campusos-api');
      expect(record.requestId).toBe(id);
      expect(record.route).not.toContain('?');
    }
  });

  it('logs a real known 5xx once with safe classification and correlation', async () => {
    const id = 'known-503-correlation';
    const sentinel = 'oauth-secret-code-value';
    const res = await http
      .get(`/api/v1/auth/google/callback?code=${sentinel}&state=${sentinel}`)
      .set(REQUEST_ID_HEADER, id)
      .set('Authorization', `Bearer ${sentinel}`);
    expect(res.status).toBe(503); // Google is intentionally unconfigured in tests
    expect(res.headers[REQUEST_ID_HEADER]).toBe(id);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
    await settle();

    const failures = records().filter(
      (record) => record.event === 'request.failed',
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      level: 'error',
      requestId: id,
      statusCode: 503,
      errorCode: 'FEATURE_DISABLED',
      errorClass: 'ServiceUnavailableException',
      message: 'Server request failed',
    });
    expect(lines.join('\n')).not.toContain(sentinel);
  });

  it('classifies an unexpected Error as 500 without logging its message/stack', () => {
    const sentinel = 'DATABASE_PASSWORD=must-never-appear';
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ method: 'POST', route: { path: '/safe/:id' } }),
      }),
    } as unknown as ArgumentsHost;

    runWithRequestId('unexpected-500', () => {
      new GlobalExceptionFilter().catch(new Error(sentinel), host);
    });

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
    const failure = records().find(
      (record) => record.event === 'request.failed',
    );
    expect(failure).toMatchObject({
      requestId: 'unexpected-500',
      statusCode: 500,
      errorCode: 'INTERNAL_ERROR',
      errorClass: 'Error',
      message: 'Server request failed',
    });
    expect(lines.join('\n')).not.toContain(sentinel);
  });

  it('does not classify expected 4xx responses as server failures', async () => {
    const res = await http
      .get('/api/v1/me')
      .set(REQUEST_ID_HEADER, 'expected-401');
    expect(res.status).toBe(401);
    await settle();
    expect(
      records().filter((record) => record.event === 'request.failed'),
    ).toHaveLength(0);
    expect(
      records().find((record) => record.event === 'request.completed'),
    ).toMatchObject({ requestId: 'expected-401', statusCode: 401 });
  });

  it('drops arbitrary fields and sanitizes bounded system messages', () => {
    const record = operationalLogger.write({
      level: 'error',
      event: 'request.failed',
      requestId: 'logger-boundary',
      message: `safe\r\nmessage${'x'.repeat(300)}`,
      // Compile-time schema rejects this; the cast proves runtime behavior
      // when a JavaScript caller attempts to append an arbitrary secret key.
      secretToken: 'must-not-appear',
    } as never);
    expect(record).not.toHaveProperty('secretToken');
    expect(record.message).not.toMatch(/[\r\n]/);
    expect(record.message!.length).toBe(160);
    expect(lines[0]).not.toContain('must-not-appear');
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });
});
