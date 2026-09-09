import { Body, Controller, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { PERMISSIONS, type CredentialLink } from '@campusos/shared';
import { CredentialTokensService } from '../auth/credential-tokens.service';
import { UserLifecycleService } from './user-lifecycle.service';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../access/authenticated-user';

const reasonSchema = z.object({ reason: z.string().trim().min(5).max(500) });

/** Admin credential management (M10-W2) + account lifecycle (M21-W1). */
@Controller('users')
export class UsersController {
  constructor(
    private readonly credentials: CredentialTokensService,
    private readonly lifecycle: UserLifecycleService,
  ) {}

  // ── M21-W1 — account lifecycle (verb endpoints, O-1) ─────────────────────

  @Post(':id/suspend')
  @RequirePermission(PERMISSIONS.USERS_MANAGE)
  suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: { reason: string },
  ) {
    return this.lifecycle.suspend(user, id, body.reason);
  }

  @Post(':id/reactivate')
  @RequirePermission(PERMISSIONS.USERS_MANAGE)
  reactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.lifecycle.reactivate(user, id);
  }

  @Post(':id/archive')
  @RequirePermission(PERMISSIONS.USERS_MANAGE)
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: { reason: string },
  ) {
    return this.lifecycle.archive(user, id, body.reason);
  }

  /**
   * Issues a one-time, expiring password-reset link for a user in the
   * caller's college. Any previous active reset links stop working.
   */
  @Post(':id/reset-link')
  @RequirePermission(PERMISSIONS.USERS_MANAGE)
  resetLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<CredentialLink> {
    return this.credentials.issueResetLink(user, id);
  }
}
