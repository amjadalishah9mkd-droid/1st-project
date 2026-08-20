import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@campusos/shared';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

/**
 * Declares the permission a route requires (Blueprint §5).
 * Evaluated by PermissionsGuard through PolicyService — the only
 * authorization path in the application.
 */
export const RequirePermission = (permission: PermissionKey) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permission);
