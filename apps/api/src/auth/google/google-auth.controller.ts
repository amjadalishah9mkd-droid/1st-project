import {
  Controller,
  Delete,
  Get,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { GoogleAuthService, type GoogleIntent } from './google-auth.service';
import { setAuthCookies } from '../session-cookies';
import { RateLimiterService } from '../../common/rate-limiter.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../access/current-user.decorator';
import type { AuthenticatedUser } from '../../access/authenticated-user';

/**
 * M11-W2 — Google OIDC endpoints.
 *
 *  GET  /auth/google/start?intent=login|register(&college=CODE)  (public, 302)
 *  GET  /auth/google/callback                                    (public, 302)
 *  GET  /auth/google/link                                        (auth, status)
 *  POST /auth/google/link                                        (auth, begin)
 *  DELETE /auth/google/link                                      (auth, unlink)
 *
 * The callback ends in the exact same session-issuance path as password
 * login (TokenService family + shared auth cookies). Never logs codes,
 * tokens or secrets.
 */
function requestMeta(req: Request): { ip: string; userAgent?: string } {
  return {
    ip: req.ip ?? req.socket.remoteAddress ?? 'unknown',
    userAgent: req.headers['user-agent'],
  };
}

const STATE_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/api/v1/auth/google',
};

@Controller('auth/google')
export class GoogleAuthController {
  constructor(
    private readonly google: GoogleAuthService,
    private readonly limiter: RateLimiterService,
  ) {}

  @Public()
  @Get('start')
  async start(
    @Query('intent') intentRaw: string | undefined,
    @Query('college') college: string | undefined,
    @Query('token') inviteToken: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    this.limiter.assert('googleStart', requestMeta(req).ip);
    // `link` intent must come through the authenticated POST /link route so
    // the state cookie is bound to a verified session, never a query param.
    // `invite` (M11-W4) is public by design: possession of the one-time
    // invite token IS the authorization, exactly like /auth/accept-invite.
    const intent: GoogleIntent =
      intentRaw === 'register'
        ? 'register'
        : intentRaw === 'invite'
          ? 'invite'
          : 'login';
    const { url, stateCookie } = await this.google.buildStart(intent, {
      collegeCode: college,
      inviteToken,
    });
    res.cookie(stateCookie.name, stateCookie.value, {
      ...STATE_COOKIE_OPTS,
      maxAge: stateCookie.maxAge,
    });
    res.redirect(url);
  }

  @Public()
  @Get('callback')
  async callback(
    @Query() query: { code?: string; state?: string; error?: string },
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const stateCookie = req.cookies?.[this.google.stateCookieName()] as
      | string
      | undefined;
    res.clearCookie(this.google.stateCookieName(), STATE_COOKIE_OPTS);

    const result = await this.google.handleCallback(
      query,
      stateCookie,
      requestMeta(req),
    );
    if (result.kind === 'session') {
      // Same cookies as password login; the web app bootstraps its access
      // token via POST /auth/refresh on load.
      setAuthCookies(res, result.tokens.refreshToken, result.me);
    }
    res.redirect(result.redirect);
  }

  @Get('link')
  linkStatus(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ available: boolean; linked: boolean; emailAtLink: string | null }> {
    return this.google.linkStatus(user.id);
  }

  @Post('link')
  async beginLink(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ url: string }> {
    const { url, stateCookie } = await this.google.beginLink(user.id);
    res.cookie(stateCookie.name, stateCookie.value, {
      ...STATE_COOKIE_OPTS,
      maxAge: stateCookie.maxAge,
    });
    return { url };
  }

  @Delete('link')
  unlink(@CurrentUser() user: AuthenticatedUser): Promise<{ unlinked: true }> {
    return this.google.unlink(user.id);
  }
}
