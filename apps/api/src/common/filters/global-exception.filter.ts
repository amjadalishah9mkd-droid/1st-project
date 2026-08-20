import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from '@prisma/client';

/**
 * Uniform error envelope (Blueprint §7):
 *   { error: { code, message, details? } }
 * Maps Nest HttpExceptions, Prisma known errors, and unknown failures.
 * Internal messages are never leaked for 5xx responses.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

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
      } else {
        this.logger.error(`Prisma error ${exception.code}`, exception.stack);
      }
    } else {
      const stack =
        exception instanceof Error ? exception.stack : String(exception);
      this.logger.error('Unhandled exception', stack);
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
