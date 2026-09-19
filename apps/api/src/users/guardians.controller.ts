import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  PERMISSIONS,
  inviteGuardianSchema,
  type GuardianChildItem,
  type GuardianLinkItem,
  type InviteGuardianInput,
} from '@campusos/shared';
import { GuardiansService } from './guardians.service';
import { RateLimiterService } from '../common/rate-limiter.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

/**
 * M13-W2 — guardian onboarding & link lifecycle.
 * Admin surfaces via users.manage; the guardian's own children list via
 * guardian.children — all PolicyService, zero role conditionals.
 */
@Controller('students/:studentId/guardians')
export class StudentGuardiansController {
  constructor(
    private readonly guardians: GuardiansService,
    private readonly limiter: RateLimiterService,
  ) {}

  @Post()
  @RequirePermission(PERMISSIONS.USERS_MANAGE)
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId') studentId: string,
    @Body(new ZodValidationPipe(inviteGuardianSchema)) body: InviteGuardianInput,
  ) {
    this.limiter.assert('guardianInvite', user.id);
    return this.guardians.invite(user, studentId, body);
  }

  @Get()
  @RequirePermission(PERMISSIONS.USERS_MANAGE)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId') studentId: string,
  ): Promise<GuardianLinkItem[]> {
    return this.guardians.list(user, studentId);
  }

  @Delete(':linkId')
  @RequirePermission(PERMISSIONS.USERS_MANAGE)
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId') studentId: string,
    @Param('linkId') linkId: string,
  ): Promise<{ revoked: true }> {
    return this.guardians.revoke(user, studentId, linkId);
  }
}

@Controller('guardian')
export class GuardianSelfController {
  constructor(private readonly guardians: GuardiansService) {}

  @Get('children')
  @RequirePermission(PERMISSIONS.GUARDIAN_CHILDREN)
  children(@CurrentUser() user: AuthenticatedUser): Promise<GuardianChildItem[]> {
    return this.guardians.children(user);
  }
}
