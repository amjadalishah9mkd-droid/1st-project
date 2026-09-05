import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from './token.service';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ALLOW_PENDING_PASSWORD_KEY } from './allow-pending-password.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

/**
 * Global JwtAuthGuard (Blueprint §9).
 *  - Every route requires a valid access token unless marked @Public.
 *  - The user is loaded fresh from the DB (status + mustChangePassword are
 *    never trusted from the token).
 *  - Non-ACTIVE users are rejected immediately.
 *  - mustChangePassword=true blocks all routes except those explicitly
 *    marked @AllowPendingPassword.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers?.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    }

    let payload: { sub: string };
    try {
      payload = this.tokens.verifyAccessToken(header.slice(7));
    } catch {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        collegeId: true,
        email: true,
        role: true,
        status: true,
        verificationStatus: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        mustChangePassword: true,
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    }

    if (user.mustChangePassword) {
      const allowed = this.reflector.getAllAndOverride<boolean>(
        ALLOW_PENDING_PASSWORD_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!allowed) {
        throw new ForbiddenException({
          code: 'PASSWORD_CHANGE_REQUIRED',
          message: 'You must change your password before continuing',
        });
      }
    }

    request.user = user satisfies AuthenticatedUser;
    return true;
  }
}
