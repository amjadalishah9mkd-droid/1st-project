import { Controller, Get } from '@nestjs/common';
import {
  PERMISSIONS,
  ROLE_PERMISSION_MATRIX,
  type PermissionGrant,
} from '@campusos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RequirePermission } from './require-permission.decorator';

/**
 * Access administration endpoints (M1 scope).
 * GET /access/permissions — the live permission catalog + role matrix as
 * stored in the database. Feeds the Settings → permissions view (M9) and
 * serves as the canonical protected admin endpoint for authorization tests.
 */
@Controller('access')
export class AccessController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('permissions')
  @RequirePermission(PERMISSIONS.SETTINGS_MANAGE)
  async permissionMatrix(): Promise<{
    catalog: Array<{ key: string; description: string }>;
    matrix: Array<{ role: string; key: string; scope: string }>;
    expectedGrantCount: number;
  }> {
    const [catalog, rolePermissions] = await Promise.all([
      this.prisma.permission.findMany({
        select: { key: true, description: true },
        orderBy: { key: 'asc' },
      }),
      this.prisma.rolePermission.findMany({
        include: { permission: { select: { key: true } } },
        orderBy: [{ role: 'asc' }],
      }),
    ]);

    return {
      catalog,
      matrix: rolePermissions.map((row) => ({
        role: row.role,
        key: row.permission.key,
        scope: row.scope,
      })),
      expectedGrantCount: ROLE_PERMISSION_MATRIX.length,
    };
  }
}

export type { PermissionGrant };
