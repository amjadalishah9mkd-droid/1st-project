import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  acceptInviteSchema,
  changePasswordSchema,
  loginSchema,
  type AcceptInviteInput,
  type AuthPayload,
  type ChangePasswordInput,
  type LoginInput,
  type MePayload,
} from '@campusos/shared';
import { AuthService } from './auth.service';
import { CredentialTokensService } from './credential-tokens.service';
import { REFRESH_TOKEN_TTL_MS } from './token.service';
import {
  REFRESH_COOKIE,
  SESSION_HINT_COOKIE,
  clearAuthCookies,
  encodeSessionHint,
  setAuthCookies,
} from './session-cookies';

export { REFRESH_COOKIE, SESSION_HINT_COOKIE };
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Public } from '../common/decorators/public.decorator';
import { AllowPendingPassword } from './allow-pending-password.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

function requestMeta(req: Request): { ip: string; userAgent?: string } {
  return {
    ip: req.ip ?? req.socket.remoteAddress ?? 'unknown',
    userAgent: req.headers['user-agent'],
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly credentials: CredentialTokensService,
  ) {}

  /** Invitation acceptance (M10-W2) — INVITE tokens only. */
  @Public()
  @Post('accept-invite')
  @HttpCode(200)
  acceptInvite(
    @Body(new ZodValidationPipe(acceptInviteSchema)) body: AcceptInviteInput,
  ): Promise<{ accepted: true }> {
    return this.credentials.accept(body.token, 'INVITE', body.password);
  }

  /** Password reset via admin-issued link (M10-W2) — RESET tokens only. */
  @Public()
  @Post('reset-password')
  @HttpCode(200)
  resetPassword(
    @Body(new ZodValidationPipe(acceptInviteSchema)) body: AcceptInviteInput,
  ): Promise<{ accepted: true }> {
    return this.credentials.accept(body.token, 'RESET', body.password);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthPayload> {
    const { tokens, me } = await this.auth.login(body, requestMeta(req));
    setAuthCookies(res, tokens.refreshToken, me);
    return { accessToken: tokens.accessToken, user: me };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthPayload> {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!raw) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'No active session',
      });
    }
    try {
      const { tokens, me } = await this.auth.refresh(raw, requestMeta(req));
      setAuthCookies(res, tokens.refreshToken, me);
      return { accessToken: tokens.accessToken, user: me };
    } catch (error) {
      clearAuthCookies(res);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ loggedOut: true }> {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearAuthCookies(res);
    return { loggedOut: true };
  }

  @Post('change-password')
  @AllowPendingPassword()
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(changePasswordSchema))
    body: ChangePasswordInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ changed: true }> {
    await this.auth.changePassword(user, body, req.cookies?.[REFRESH_COOKIE]);
    // Refresh the hint cookie so middleware stops pinning /change-password.
    const me = await this.auth.buildMePayload(user.id);
    res.cookie(SESSION_HINT_COOKIE, encodeSessionHint(me), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: REFRESH_TOKEN_TTL_MS,
    });
    return { changed: true };
  }
}

@Controller('me')
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @AllowPendingPassword()
  async me(@CurrentUser() user: AuthenticatedUser): Promise<MePayload> {
    return this.auth.buildMePayload(user.id);
  }
}
