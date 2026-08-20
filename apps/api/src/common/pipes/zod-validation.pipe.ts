import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

/**
 * Zod validation pipe (Blueprint §6/§7).
 * Server-side validation uses the exact schemas from @campusos/shared, the
 * same objects the web client validates forms with — one validation source,
 * no duplicated rules.
 *
 * Usage: @Body(new ZodValidationPipe(loginSchema)) body: LoginInput
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
