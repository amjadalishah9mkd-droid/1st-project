import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  acceptInviteSchema,
  inviteInfoQuerySchema,
  changePasswordSchema,
  loginSchema,
  updatePreferencesSchema,
  type AcceptInviteInput,
  type AuthPayload,
  type ChangePasswordInput,
  type LoginInput,
  type MePayload,
  type UpdatePreferencesInput,
} from '@campusos/shared';
import { AuthService } from './auth.service';
import { CredentialTokensService } from './credential-tokens.service';
import { GoogleAuthService } from './google/google-auth.service';
import { RateLimiterService } from '../common/rate-limiter.service';
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
    private readonly google: GoogleAuthService,
    private readonly limiter: RateLimiterService,
  ) {}

  /**
   * M11-W5 — public feature flags for the login page. Exposes only
   * booleans; never client IDs or secrets.
   */
  @Public()
  @Get('config')
  authConfig(): { google: boolean } {
    return { google: this.google.isConfigured() };
  }

  /**
   * M11-W4 — acceptance options for a valid invite (drives the accept
   * page). Invalid tokens get the same generic error as acceptance.
   */
  @Public()
  @Get('invite-info')
  async inviteInfo(
    @Query() query: unknown,
    @Req() req: Request,
  ): Promise<{ mode: 'password' | 'google' | 'both'; collegeName: string; firstName: string }> {
    // M24-W1 (N-1 array class): the rate limiter deliberately stays FIRST,
    // so validation cannot become a way to skip it. The token is then
    // validated with the shared schema (via the same pipe, so the error
    // envelope is identical) before it can reach the credential lookup —
    // an array-valued token previously reached the lookup and produced a
    // 500 on this public endpoint.
    this.limiter.assert('inviteInfo', requestMeta(req).ip);
    const { token } = new ZodValidationPipe(inviteInfoQuerySchema).transform(query);
    const record = await this.credentials.lookupValid(token, 'INVITE');
    return {
      mode: this.credentials.inviteMode(record, this.google.isConfigured()),
      collegeName: record.user.college.name,
      firstName: record.user.firstName,
    };
  }

  /** Invitation acceptance (M10-W2; W4 adds verification side effects). */
  @Public()
  @Post('accept-invite')
  @HttpCode(200)
  acceptInvite(
    @Body(new ZodValidationPipe(acceptInviteSchema)) body: AcceptInviteInput,
    @Req() req: Request,
  ): Promise<{ accepted: true }> {
    this.limiter.assert('tokenEndpoints', requestMeta(req).ip);
    return this.credentials.accept(
      body.token,
      'INVITE',
      body.password,
      this.google.isConfigured(),
    );
  }

  /** Password reset via admin-issued link (M10-W2) — RESET tokens only. */
  @Public()
  @Post('reset-password')
  @HttpCode(200)
  resetPassword(
    @Body(new ZodValidationPipe(acceptInviteSchema)) body: AcceptInviteInput,
    @Req() req: Request,
  ): Promise<{ accepted: true }> {
    this.limiter.assert('tokenEndpoints', requestMeta(req).ip);
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

  /** M12-W2 — single email opt-out preference; caller's own row only. */
  @Patch('preferences')
  updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updatePreferencesSchema))
    body: UpdatePreferencesInput,
  ): Promise<MePayload> {
    return this.auth.updatePreferences(user, body);
  }
}
