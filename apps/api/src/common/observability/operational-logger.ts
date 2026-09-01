export type OperationalLogLevel = 'info' | 'warn' | 'error';

export interface OperationalLogInput {
  level: OperationalLogLevel;
  event: 'request.completed' | 'request.failed';
  requestId?: string;
  method?: string;
  route?: string;
  statusCode?: number;
  durationMs?: number;
  errorCode?: string;
  errorClass?: string;
  message?: string;
}

export interface OperationalLogRecord {
  timestamp: string;
  level: OperationalLogLevel;
  service: 'campusos-api';
  environment: string;
  event: 'request.completed' | 'request.failed';
  requestId?: string;
  method?: string;
  route?: string;
  statusCode?: number;
  durationMs?: number;
  errorCode?: string;
  errorClass?: string;
  message?: string;
}

export type OperationalLogSink = (
  line: string,
  level: OperationalLogLevel,
) => void;

const SAFE_TOKEN = /^[A-Za-z0-9._:/-]{1,160}$/;

function boundedToken(value: string | undefined): string | undefined {
  return value && SAFE_TOKEN.test(value) ? value : undefined;
}

function boundedMessage(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // Messages are system-authored, but enforce a final injection/cardinality
  // boundary anyway: strip controls and bound length before JSON encoding.
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160);
}

function defaultSink(line: string, level: OperationalLogLevel): void {
  // Existing e2e suites intentionally disable logs. Focused W1 tests install
  // a capture sink; production/dev write one valid JSON object per line.
  if (process.env.NODE_ENV === 'test') return;
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

/**
 * M22-W1 fixed-schema operational logger. Callers cannot append arbitrary
 * keys, and every string field crosses a bounded allowlist. It deliberately
 * has no API for request/response bodies, headers, cookies, URLs, identities,
 * stack traces or arbitrary metadata. AuditLog remains entirely separate.
 */
export class OperationalLogger {
  private sink: OperationalLogSink = defaultSink;

  setSink(sink: OperationalLogSink): void {
    this.sink = sink;
  }

  resetSink(): void {
    this.sink = defaultSink;
  }

  write(input: OperationalLogInput): OperationalLogRecord {
    const record: OperationalLogRecord = {
      timestamp: new Date().toISOString(),
      level: input.level,
      service: 'campusos-api',
      environment: boundedToken(process.env.NODE_ENV) ?? 'development',
      event: input.event,
      ...(boundedToken(input.requestId)
        ? { requestId: boundedToken(input.requestId) }
        : {}),
      ...(boundedToken(input.method) ? { method: boundedToken(input.method) } : {}),
      ...(boundedToken(input.route) ? { route: boundedToken(input.route) } : {}),
      ...(Number.isInteger(input.statusCode)
        ? { statusCode: input.statusCode }
        : {}),
      ...(Number.isFinite(input.durationMs)
        ? { durationMs: Math.round(Math.max(0, input.durationMs!) * 100) / 100 }
        : {}),
      ...(boundedToken(input.errorCode)
        ? { errorCode: boundedToken(input.errorCode) }
        : {}),
      ...(boundedToken(input.errorClass)
        ? { errorClass: boundedToken(input.errorClass) }
        : {}),
      ...(boundedMessage(input.message)
        ? { message: boundedMessage(input.message) }
        : {}),
    };
    this.sink(JSON.stringify(record), input.level);
    return record;
  }
}

/** Process-local singleton; W2 counters will remain separately bounded. */
export const operationalLogger = new OperationalLogger();
