import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as reachable while mustChangePassword=true.
 * Everything else is blocked for such users (Blueprint §9 forced change).
 * Applied to: /auth/change-password, /auth/logout, /auth/refresh, /me.
 */
export const ALLOW_PENDING_PASSWORD_KEY = 'allowPendingPassword';
export const AllowPendingPassword = () =>
  SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);
