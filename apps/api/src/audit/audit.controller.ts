import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { PERMISSIONS, paginationQuerySchema } from '@campusos/shared';
import { AuditService, type AuditListQuery } from './audit.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

const auditListQuerySchema = paginationQuerySchema.extend({
  action: z.string().trim().max(100).optional(),
  actorId: z.string().trim().max(64).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * M12-W4 — read-only audit log viewer (audit.read, ADMIN/ALL).
 * This is the module's only endpoint: no mutation routes exist. The write
 * path (AuditService.log) is internal and untouched.
 */
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission(PERMISSIONS.AUDIT_READ)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(auditListQuerySchema)) query: AuditListQuery,
  ) {
    return this.audit.list(user, query);
  }
}
