import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as publicly accessible (no authentication).
 * Consumed by the global JwtAuthGuard introduced in M1; declared in M0 so the
 * health endpoint carries the correct contract from the start.
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
