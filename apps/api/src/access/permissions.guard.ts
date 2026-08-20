import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@campusos/shared';
import { PolicyService, ResourceContext } from './policy.service';
import { REQUIRE_PERMISSION_KEY } from './require-permission.decorator';
import type { AuthenticatedUser } from './authenticated-user';

/**
 * PermissionsGuard (Blueprint §9 request path).
 * Reads @RequirePermission metadata and delegates to PolicyService. Routes
 * without the decorator perform their (finer-grained) checks inside services,
 * still via PolicyService.
 *
 * Route-level resource context: params/query named sectionId/departmentId are
 * forwarded; object-level context is supplied by services for body-derived
 * resources.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly policy: PolicyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<
      PermissionKey | undefined
    >(REQUIRE_PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    if (!permission) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;
    if (!user) {
      // JwtAuthGuard runs first; a missing user means a public route carrying
      // @RequirePermission, which is a programming error — deny.
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      });
    }

    const resourceContext: ResourceContext = {
      sectionId: request.params?.sectionId ?? request.query?.sectionId,
      departmentId: request.params?.departmentId ?? request.query?.departmentId,
    };

    const allowed = await this.policy.can(user, permission, resourceContext);
    if (!allowed) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      });
    }
    return true;
  }
}
