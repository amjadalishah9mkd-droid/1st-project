import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Uniform success envelope (Blueprint §7): { data, meta? }.
 * Handlers return either a raw value (wrapped as { data }) or an object of the
 * shape { data, meta } (passed through). Error responses are handled by the
 * GlobalExceptionFilter and never pass through here.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value) => {
        if (
          value !== null &&
          typeof value === 'object' &&
          'data' in (value as Record<string, unknown>) &&
          Object.keys(value as Record<string, unknown>).every((key) =>
            ['data', 'meta'].includes(key),
          )
        ) {
          return value;
        }
        return { data: value ?? null };
      }),
    );
  }
}
