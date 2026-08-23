import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { readCollegeSettings, type MePayload } from '@campusos/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { TokenService, type IssuedTokens } from '../token.service';
import { AuthService } from '../auth.service';
import { CredentialTokensService } from '../credential-tokens.service';
import { OnboardingService } from '../onboarding.service';
import {
  GOOGLE_OIDC_CLIENT,
  type GoogleOidcClient,
} from './google-oidc.client';

/**
 * M11-W2 — Google OIDC core (Blueprint Rev. B §3, §6, §9).
 *
 * Invariants:
 *  - Google `sub` (via AuthIdentity) is the only provider identity key.
 *    Email is NEVER identity proof and NEVER auto-links accounts.
 *  - Sessions are issued through the existing TokenService family path —
 *    no second session architecture.
 *  - Feature is gated per college by settings.googleAuth (off|additive|
 *    required) and globally by env configuration.
 *  - No hardcoded role checks; behavior branches on data (college settings,
 *    studentProfile existence, passwordHash presence).
 */

export type GoogleIntent = 'login' | 'register' | 'link' | 'invite';

const STATE_COOKIE = 'cos_oauth';
const STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const VALID_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

interface StatePayload {
  s: string; // state
  n: string; // nonce
  v: string; // PKCE code_verifier
  i: GoogleIntent;
  u?: string; // userId (link intent only)
  c?: string; // collegeId (register intent only)
  t?: string; // raw invite token (invite intent only; cookie is HMAC-signed
  //             httpOnly and the token never round-trips through Google)
  exp: number;
}

export interface GoogleClaims {
  sub: string;
  email: string;
  givenName: string;
  familyName: string;
}

function featureDisabled(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'FEATURE_DISABLED',
    message: 'Google sign-in is not available',
  });
}

function authFailed(): UnauthorizedException {
  return new UnauthorizedException({
    code: 'GOOGLE_AUTH_FAILED',
    message: 'Google sign-in could not be completed. Please try again.',
  });
}

@Injectable()
export class GoogleAuthService {
  /** One-time state guard (replay prevention within the state TTL). */
  private consumedStates = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
    private readonly credentials: CredentialTokensService,
    private readonly onboarding: OnboardingService,
    @Inject(GOOGLE_OIDC_CLIENT) private readonly oidc: GoogleOidcClient,
  ) {}

  // ── Configuration ────────────────────────────────────────────────────────

  isConfigured(): boolean {
    return Boolean(
      process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.OAUTH_REDIRECT_BASE,
    );
  }

  private clientId(): string {
    return process.env.GOOGLE_CLIENT_ID ?? '';
  }

  redirectUri(): string {
    return `${process.env.OAUTH_REDIRECT_BASE}/api/v1/auth/google/callback`;
  }

  private stateSecret(): string {
    // Derived from the access secret; never used raw for JWTs.
    return createHash('sha256')
      .update(`oauth-state:${process.env.JWT_ACCESS_SECRET ?? ''}`)
      .digest('hex');
  }

  // ── State cookie (HMAC-signed, short TTL, one-time) ─────────────────────

  private signState(payload: StatePayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = createHmac('sha256', this.stateSecret())
      .update(body)
      .digest('base64url');
    return `${body}.${mac}`;
  }

  private parseState(cookie: string | undefined): StatePayload | null {
    if (!cookie) return null;
    const [body, mac] = cookie.split('.');
    if (!body || !mac) return null;
    const expected = createHmac('sha256', this.stateSecret())
      .update(body)
      .digest('base64url');
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as StatePayload;
      if (payload.exp < Date.now()) return null;
      return payload;
    } catch {
      return null;
    }
  }

  private consumeState(state: string): boolean {
    // Sweep expired entries opportunistically.
    const now = Date.now();
    for (const [key, exp] of this.consumedStates) {
      if (exp < now) this.consumedStates.delete(key);
    }
    if (this.consumedStates.has(state)) return false;
    this.consumedStates.set(state, now + STATE_TTL_MS);
    return true;
  }

  // ── Start: build the Google authorize redirect ──────────────────────────

  async buildStart(
    intent: GoogleIntent,
    options: {
      linkUserId?: string;
      collegeCode?: string;
      inviteToken?: string;
    } = {},
  ): Promise<{ url: string; stateCookie: { name: string; value: string; maxAge: number } }> {
    if (!this.isConfigured()) throw featureDisabled();

    const payload: StatePayload = {
      s: randomBytes(24).toString('base64url'),
      n: randomBytes(24).toString('base64url'),
      v: randomBytes(48).toString('base64url'), // PKCE verifier (43–128 chars)
      i: intent,
      exp: Date.now() + STATE_TTL_MS,
    };

    if (intent === 'link') {
      if (!options.linkUserId) throw authFailed();
      payload.u = options.linkUserId;
    }

    if (intent === 'invite') {
      // M11-W4: validates the invite up front (generic INVALID_TOKEN on
      // failure) and refuses colleges where Google auth is off.
      const record = await this.credentials.lookupValid(
        options.inviteToken ?? '',
        'INVITE',
      );
      const mode = this.credentials.inviteMode(record, true);
      if (mode === 'password') throw featureDisabled();
      payload.t = options.inviteToken;
    }

    if (intent === 'register') {
      const college = options.collegeCode
        ? await this.prisma.college.findUnique({
            where: { code: options.collegeCode },
          })
        : null;
      if (!college) {
        throw new BadRequestException({
          code: 'COLLEGE_REQUIRED',
          message: 'Select your college to register',
        });
      }
      const settings = readCollegeSettings(college.settings);
      if (settings.googleAuth === 'off' || !settings.allowSelfRegistration) {
        throw new ForbiddenException({
          code: 'SELF_REGISTRATION_DISABLED',
          message: 'Self-registration is not enabled for this college',
        });
      }
      payload.c = college.id;
    }

    const challenge = createHash('sha256')
      .update(payload.v)
      .digest('base64url');

    const url = new URL(GOOGLE_AUTHORIZE);
    url.searchParams.set('client_id', this.clientId());
    url.searchParams.set('redirect_uri', this.redirectUri());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', payload.s);
    url.searchParams.set('nonce', payload.n);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', 'select_account');

    return {
      url: url.toString(),
      stateCookie: {
        name: STATE_COOKIE,
        value: this.signState(payload),
        maxAge: STATE_TTL_MS,
      },
    };
  }

  stateCookieName(): string {
    return STATE_COOKIE;
  }

  // ── Claim validation (iss / aud / exp / nonce / email_verified) ─────────

  validateClaims(
    payload: Record<string, unknown>,
    expectedNonce: string,
  ): GoogleClaims {
    const iss = payload.iss;
    const aud = payload.aud;
    const exp = payload.exp;
    const nonce = payload.nonce;
    const sub = payload.sub;
    const email = payload.email;
    const emailVerified = payload.email_verified;

    if (typeof iss !== 'string' || !VALID_ISSUERS.includes(iss)) throw authFailed();
    if (aud !== this.clientId()) throw authFailed();
    if (typeof exp !== 'number' || exp * 1000 <= Date.now()) throw authFailed();
    if (typeof nonce !== 'string' || nonce !== expectedNonce) throw authFailed();
    if (emailVerified !== true) throw authFailed();
    if (typeof sub !== 'string' || sub.length === 0) throw authFailed();
    if (typeof email !== 'string' || email.length === 0) throw authFailed();

    return {
      sub,
      email: email.toLowerCase(),
      givenName:
        typeof payload.given_name === 'string' ? payload.given_name : 'Student',
      familyName:
        typeof payload.family_name === 'string' ? payload.family_name : '',
    };
  }

  // ── Callback ─────────────────────────────────────────────────────────────

  /**
   * Handles the Google redirect. Returns either a session (login/register)
   * or a link confirmation; the controller turns this into cookies + a
   * browser redirect. All failures map to redirect-safe error codes.
   */
  async handleCallback(
    query: { code?: string; state?: string; error?: string },
    stateCookie: string | undefined,
    meta: { ip: string; userAgent?: string },
  ): Promise<
    | { kind: 'session'; tokens: IssuedTokens; me: MePayload; redirect: string }
    | { kind: 'redirect'; redirect: string }
  > {
    if (!this.isConfigured()) throw featureDisabled();

    const state = this.parseState(stateCookie);
    if (
      !state ||
      !query.state ||
      query.state !== state.s ||
      !this.consumeState(state.s)
    ) {
      // Missing/tampered/expired/replayed state → generic failure.
      return { kind: 'redirect', redirect: '/login?error=google_auth_failed' };
    }
    if (query.error || !query.code) {
      return { kind: 'redirect', redirect: '/login?error=google_auth_failed' };
    }

    let claims: GoogleClaims;
    try {
      const payload = await this.oidc.exchangeCode(
        query.code,
        state.v,
        this.redirectUri(),
      );
      claims = this.validateClaims(payload, state.n);
    } catch {
      return { kind: 'redirect', redirect: '/login?error=google_auth_failed' };
    }

    switch (state.i) {
      case 'login':
        return this.completeLogin(claims, meta);
      case 'link':
        return this.completeLink(claims, state.u);
      case 'register':
        return this.completeRegister(claims, state.c, meta);
      case 'invite':
        return this.completeInvite(claims, state.t, meta);
    }
  }

  private async completeLogin(
    claims: GoogleClaims,
    meta: { ip: string; userAgent?: string },
  ): Promise<
    | { kind: 'session'; tokens: IssuedTokens; me: MePayload; redirect: string }
    | { kind: 'redirect'; redirect: string }
  > {
    const identity = await this.prisma.authIdentity.findUnique({
      where: {
        provider_providerSub: { provider: 'GOOGLE', providerSub: claims.sub },
      },
      include: { user: { include: { college: true } } },
    });

    // Unknown Google account: NEVER auto-create on login intent and NEVER
    // link by email match — the account must be linked explicitly first.
    if (!identity) {
      return { kind: 'redirect', redirect: '/login?error=google_not_linked' };
    }

    const user = identity.user;
    // Suspended/archived users are rejected exactly like password login.
    if (user.status !== 'ACTIVE') {
      await this.audit.log({
        collegeId: user.collegeId,
        actorId: user.id,
        action: 'auth.login.failure',
        targetType: 'User',
        targetId: user.id,
        metadata: { reason: 'inactive_account', method: 'google' },
      });
      return { kind: 'redirect', redirect: '/login?error=google_auth_failed' };
    }

    const settings = readCollegeSettings(user.college.settings);
    if (settings.googleAuth === 'off') {
      return { kind: 'redirect', redirect: '/login?error=google_disabled' };
    }

    const tokens = await this.tokens.issueFamily(user, meta);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'auth.google_login',
      targetType: 'User',
      targetId: user.id,
    });
    return {
      kind: 'session',
      tokens,
      me: await this.auth.buildMePayload(user.id),
      redirect: '/dashboard',
    };
  }

  private async completeLink(
    claims: GoogleClaims,
    userId: string | undefined,
  ): Promise<{ kind: 'redirect'; redirect: string }> {
    if (!userId) {
      return { kind: 'redirect', redirect: '/login?error=google_auth_failed' };
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { college: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      return { kind: 'redirect', redirect: '/login?error=google_auth_failed' };
    }
    const settings = readCollegeSettings(user.college.settings);
    if (settings.googleAuth === 'off') {
      return { kind: 'redirect', redirect: '/login?error=google_disabled' };
    }

    try {
      await this.prisma.authIdentity.create({
        data: {
          userId: user.id,
          provider: 'GOOGLE',
          providerSub: claims.sub,
          emailAtLink: claims.email,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        // Either this Google account is linked elsewhere, or the user
        // already holds a Google identity. Same generic outcome.
        return {
          kind: 'redirect',
          redirect: '/dashboard?googleLink=already_linked',
        };
      }
      throw error;
    }

    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'auth.google_linked',
      targetType: 'User',
      targetId: user.id,
    });

    // M11-W4 (journey D): a session-authenticated link by an account that
    // owns its StudentProfile is admin-provisioned identity proof — the
    // student auto-verifies and their identity slot is held in PostgreSQL.
    try {
      const onboarding = await this.prisma.$transaction((tx) =>
        this.onboarding.applyVerification(tx, user.id, null),
      );
      await this.onboarding.announce(user, onboarding, 'link');
    } catch {
      // IDENTITY_CONFLICT (already bound elsewhere) never unwinds the link
      // itself; verification simply does not happen.
    }
    return { kind: 'redirect', redirect: '/dashboard?googleLink=success' };
  }

  private async completeRegister(
    claims: GoogleClaims,
    collegeId: string | undefined,
    meta: { ip: string; userAgent?: string },
  ): Promise<
    | { kind: 'session'; tokens: IssuedTokens; me: MePayload; redirect: string }
    | { kind: 'redirect'; redirect: string }
  > {
    if (!collegeId) {
      return { kind: 'redirect', redirect: '/login?error=google_auth_failed' };
    }
    const college = await this.prisma.college.findUnique({
      where: { id: collegeId },
    });
    if (!college) {
      return { kind: 'redirect', redirect: '/login?error=google_auth_failed' };
    }
    // Re-validate at callback time — settings may have changed mid-flow.
    const settings = readCollegeSettings(college.settings);
    if (settings.googleAuth === 'off' || !settings.allowSelfRegistration) {
      return {
        kind: 'redirect',
        redirect: '/login?error=self_registration_disabled',
      };
    }

    // Returning Google account → just log in (idempotent registration).
    const existing = await this.prisma.authIdentity.findUnique({
      where: {
        provider_providerSub: { provider: 'GOOGLE', providerSub: claims.sub },
      },
    });
    if (existing) {
      return this.completeLogin(claims, meta);
    }

    try {
      const user = await this.prisma.user.create({
        data: {
          college: { connect: { id: college.id } },
          email: claims.email,
          passwordHash: null,
          role: 'STUDENT',
          verificationStatus: 'UNVERIFIED',
          firstName: claims.givenName,
          lastName: claims.familyName,
          mustChangePassword: false,
          authIdentities: {
            create: {
              provider: 'GOOGLE',
              providerSub: claims.sub,
              emailAtLink: claims.email,
            },
          },
        },
      });

      const tokens = await this.tokens.issueFamily(user, meta);
      await this.audit.log({
        collegeId: user.collegeId,
        actorId: user.id,
        action: 'auth.google_login',
        targetType: 'User',
        targetId: user.id,
        metadata: { firstLogin: true },
      });
      return {
        kind: 'session',
        tokens,
        me: await this.auth.buildMePayload(user.id),
        redirect: '/verify',
      };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        // Race on sub, or the email already exists in this college. Email
        // match is NOT identity proof — never auto-link; generic guidance.
        return {
          kind: 'redirect',
          redirect: '/login?error=registration_unavailable',
        };
      }
      throw error;
    }
  }

  /**
   * M11-W4 — invitation acceptance via Google. One transaction, ordered so
   * a failure anywhere leaves the invite token unconsumed:
   *   AuthIdentity create → token claim → onboarding (supersession +
   *   synthetic APPROVED claim + VERIFIED).
   */
  private async completeInvite(
    claims: GoogleClaims,
    rawToken: string | undefined,
    meta: { ip: string; userAgent?: string },
  ): Promise<
    | { kind: 'session'; tokens: IssuedTokens; me: MePayload; redirect: string }
    | { kind: 'redirect'; redirect: string }
  > {
    if (!rawToken) {
      return { kind: 'redirect', redirect: '/login?error=google_auth_failed' };
    }
    let record: Awaited<ReturnType<CredentialTokensService['lookupValid']>>;
    try {
      record = await this.credentials.lookupValid(rawToken, 'INVITE');
    } catch {
      return { kind: 'redirect', redirect: '/login?error=google_auth_failed' };
    }
    const settings = readCollegeSettings(record.user.college.settings);
    if (record.user.studentProfile && settings.googleAuth === 'off') {
      return { kind: 'redirect', redirect: '/login?error=google_disabled' };
    }

    let onboarding: Awaited<
      ReturnType<OnboardingService['applyVerification']>
    > | null = null;
    try {
      onboarding = await this.prisma.$transaction(async (tx) => {
        // 1. Bind the Google identity first: if this Google account is
        //    already linked elsewhere (P2002), the transaction aborts and
        //    the invite token remains valid for a retry with the right
        //    account. Email match is never identity proof.
        await tx.authIdentity.create({
          data: {
            userId: record.userId,
            provider: 'GOOGLE',
            providerSub: claims.sub,
            emailAtLink: claims.email,
          },
        });
        // 2. Consume the token atomically (one-time across BOTH methods).
        const claimed = await tx.credentialToken.updateMany({
          where: { id: record.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (claimed.count !== 1) throw authFailed();
        // 3. No pending forced password change for Google-activated users.
        await tx.user.update({
          where: { id: record.userId },
          data: { mustChangePassword: false },
        });
        // 4. Verification + supersession + synthetic APPROVED claim.
        return this.onboarding.applyVerification(
          tx,
          record.userId,
          record.createdById,
        );
      });
    } catch {
      // P2002 (sub linked elsewhere), lost token race, or IDENTITY_CONFLICT
      // — all rolled back; token untouched by this attempt.
      return { kind: 'redirect', redirect: '/login?error=google_auth_failed' };
    }

    await this.audit.log({
      collegeId: record.user.collegeId,
      actorId: record.userId,
      action: 'auth.invite_accepted',
      targetType: 'User',
      targetId: record.userId,
      metadata: { method: 'google' },
    });
    await this.audit.log({
      collegeId: record.user.collegeId,
      actorId: record.userId,
      action: 'auth.google_linked',
      targetType: 'User',
      targetId: record.userId,
    });
    await this.onboarding.announce(record.user, onboarding, 'invitation');

    const tokens = await this.tokens.issueFamily(
      {
        id: record.userId,
        role: record.user.role,
        collegeId: record.user.collegeId,
      },
      meta,
    );
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { lastLoginAt: new Date() },
    });
    return {
      kind: 'session',
      tokens,
      me: await this.auth.buildMePayload(record.userId),
      redirect: '/dashboard',
    };
  }

  // ── Link / unlink (authenticated API) ────────────────────────────────────

  async beginLink(userId: string): Promise<{
    url: string;
    stateCookie: { name: string; value: string; maxAge: number };
  }> {
    if (!this.isConfigured()) throw featureDisabled();
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { college: true },
    });
    const settings = readCollegeSettings(user.college.settings);
    if (settings.googleAuth === 'off') throw featureDisabled();
    const existing = await this.prisma.authIdentity.findUnique({
      where: { userId_provider: { userId, provider: 'GOOGLE' } },
    });
    if (existing) {
      throw new BadRequestException({
        code: 'GOOGLE_ALREADY_LINKED',
        message: 'A Google account is already linked',
      });
    }
    return this.buildStart('link', { linkUserId: userId });
  }

  async unlink(userId: string): Promise<{ unlinked: true }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { college: true, studentProfile: { select: { id: true } } },
    });
    const identity = await this.prisma.authIdentity.findUnique({
      where: { userId_provider: { userId, provider: 'GOOGLE' } },
    });
    if (!identity) {
      throw new NotFoundException({
        code: 'NOT_LINKED',
        message: 'No Google account is linked',
      });
    }

    // No fallback credential → unlinking would lock the account out.
    if (user.passwordHash === null) {
      throw new BadRequestException({
        code: 'UNLINK_NO_PASSWORD',
        message:
          'This account has no password. Ask an administrator for a reset link before unlinking Google.',
      });
    }
    // Google-only mode: students (data-driven: accounts with a student
    // profile) must keep their Google identity.
    const settings = readCollegeSettings(user.college.settings);
    if (settings.googleAuth === 'required' && user.studentProfile) {
      throw new ForbiddenException({
        code: 'GOOGLE_REQUIRED',
        message: 'Google sign-in is required for students at this college',
      });
    }

    await this.prisma.authIdentity.delete({ where: { id: identity.id } });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'auth.google_unlinked',
      targetType: 'User',
      targetId: user.id,
    });
    return { unlinked: true };
  }

  /** Link status for the current user (no Google config exposure). */
  async linkStatus(userId: string): Promise<{
    available: boolean;
    linked: boolean;
    emailAtLink: string | null;
  }> {
    const identity = await this.prisma.authIdentity.findUnique({
      where: { userId_provider: { userId, provider: 'GOOGLE' } },
    });
    return {
      available: this.isConfigured(),
      linked: identity !== null,
      emailAtLink: identity?.emailAtLink ?? null,
    };
  }
}
