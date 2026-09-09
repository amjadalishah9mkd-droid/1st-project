import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { currentRequestId } from '../observability/request-context';
import { operationalLogger } from '../observability/operational-logger';
import { operationalCounters } from '../observability/operational-counters';

/**
 * Uniform error envelope (Blueprint §7):
 *   { error: { code, message, details? } }
 * Maps Nest HttpExceptions, Prisma known errors, and unknown failures.
 * Internal messages are never leaked for 5xx responses.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;
        message =
          (typeof record.message === 'string' && record.message) ||
          (Array.isArray(record.message) && record.message.join('; ')) ||
          exception.message;
        if (record.code && typeof record.code === 'string') {
          code = record.code;
        }
        if (record.details !== undefined) {
          details = record.details;
        }
      }
      if (code === 'INTERNAL_ERROR') {
        code = this.codeForStatus(status);
      }
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError
    ) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        code = 'UNIQUE_CONSTRAINT';
        message = 'A record with these values already exists';
        details = { fields: exception.meta?.target };
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        code = 'NOT_FOUND';
        message = 'The requested record was not found';
      } else if (exception.code === 'P2003') {
        status = HttpStatus.CONFLICT;
        code = 'FOREIGN_KEY_CONSTRAINT';
        message = 'The operation violates a data relationship constraint';
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      // M24-W1 (N-5 / N-1 array class) — DEFENCE IN DEPTH ONLY.
      //
      // A malformed client value that slips past route validation (an
      // array where a scalar is expected, an `Invalid Date`) reaches
      // Prisma as an argument-shape error. Previously that surfaced as a
      // 500, which let a client trigger server errors at will. Every
      // known instance is now rejected at the route with a precise
      // VALIDATION_ERROR; this mapping is the backstop so that any future
      // miss degrades to a controlled 400 rather than a 500.
      //
      // The message is deliberately generic: a Prisma validation error
      // text names models, fields and argument shapes, and must never be
      // returned to a client.
      status = HttpStatus.BAD_REQUEST;
      code = 'VALIDATION_ERROR';
      message = 'Request validation failed';
      // Because the response is now a 4xx it would no longer be logged by
      // the 5xx branch below, and a genuine server-side query-construction
      // bug would go silent. Log it explicitly (fixed schema, no query,
      // no arguments, no identities) so it stays diagnosable, and count it
      // as an unexpected server error because reaching here always means
      // a validation gap somewhere.
      operationalCounters.recordServerError(true);
      operationalLogger.write({
        level: 'error',
        event: 'request.failed',
        requestId: currentRequestId(),
        method: request.method,
        route:
          typeof request.route?.path === 'string'
            ? request.route.path
            : 'unmatched',
        statusCode: status,
        errorCode: code,
        errorClass: 'PrismaClientValidationError',
        message: 'Rejected malformed query arguments',
      });
    }

    // M22-W1: centralized safe visibility for EVERY 5xx, including known
    // HttpException 5xx that Nest's logger previously missed. Never serialize
    // the exception, response/body, stack, URL/query, headers or identities.
    // The completion middleware emits the status/duration record separately;
    // this is the single error-classification record for the failure.
    if (status >= 500) {
      const unexpected =
        !(exception instanceof HttpException) &&
        !(
          exception instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2002', 'P2003', 'P2025'].includes(exception.code)
        );
      operationalCounters.recordServerError(unexpected);
      operationalLogger.write({
        level: 'error',
        event: 'request.failed',
        requestId: currentRequestId(),
        method: request.method,
        route:
          typeof request.route?.path === 'string'
            ? request.route.path
            : 'unmatched',
        statusCode: status,
        errorCode: code,
        errorClass:
          exception instanceof Error
            ? exception.constructor.name
            : 'UnknownError',
        message: 'Server request failed',
      });
    }

    response.status(status).json({
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
    });
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_ERROR';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMITED';
      default:
        return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
    }
  }
}
