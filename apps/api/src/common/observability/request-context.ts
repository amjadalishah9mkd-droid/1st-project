import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { operationalLogger } from './operational-logger';

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * M22-W1 (O-1): accept only bounded ASCII correlation IDs. Any malformed,
 * oversized, Unicode, whitespace, quote, JSON-breaking or control-character
 * value is replaced with a server-generated UUID. Request IDs are correlation
 * only and are never authorization inputs.
 */
export function effectiveRequestId(value: unknown): string {
  const candidate = Array.isArray(value) ? undefined : value;
  return typeof candidate === 'string' && SAFE_REQUEST_ID.test(candidate)
    ? candidate
    : randomUUID();
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Exposed for focused concurrency tests; application code uses middleware. */
export function runWithRequestId<T>(requestId: string, callback: () => T): T {
  return storage.run({ requestId }, callback);
}

/**
 * Initializes isolated request context before cookies, auth and controllers.
 * It logs no body, query, raw path, headers, IP or identity fields.
 */
export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = effectiveRequestId(req.headers[REQUEST_ID_HEADER]);
  const started = process.hrtime.bigint();
  res.setHeader(REQUEST_ID_HEADER, requestId);

  storage.run({ requestId }, () => {
    res.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      // req.route.path is framework-defined after routing. Never fall back to
      // req.path/originalUrl: both may contain attacker-controlled values.
      const route =
        typeof req.route?.path === 'string' ? req.route.path : 'unmatched';
      // Successful health probes are intentionally suppressed to bound log
      // volume. Failures are always retained.
      if (route === '/api/v1/health' && res.statusCode < 400) return;
      operationalLogger.write({
        level: res.statusCode >= 500 ? 'error' : 'info',
        event: 'request.completed',
        requestId,
        method: req.method,
        route,
        statusCode: res.statusCode,
        durationMs,
      });
    });
    next();
  });
}
