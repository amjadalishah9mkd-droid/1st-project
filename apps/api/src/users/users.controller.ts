import { Controller, Param, Post } from '@nestjs/common';
import { PERMISSIONS, type CredentialLink } from '@campusos/shared';
import { CredentialTokensService } from '../auth/credential-tokens.service';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

/** Admin credential management (M10-W2). */
@Controller('users')
export class UsersController {
  constructor(private readonly credentials: CredentialTokensService) {}

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
