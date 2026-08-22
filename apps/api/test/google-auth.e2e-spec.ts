import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { GOOGLE_OIDC_CLIENT } from '../src/auth/google/google-oidc.client';
import { createTestApp, cookieValue } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';
const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

/**
 * M11-W2 — Google OIDC core.
 * Uses a fake OIDC client injected at the GOOGLE_OIDC_CLIENT DI boundary:
 * the fake performs the "code exchange" by returning a payload registered
 * per authorization code. All semantic claim validation (iss/aud/exp/nonce/
 * email_verified), state/PKCE handling, login-or-create, linking and
 * unlinking run through the REAL production code paths.
 */
class FakeGoogleOidcClient {
  payloads = new Map<string, Record<string, unknown>>();
  lastCodeVerifier: string | null = null;

  register(code: string, payload: Record<string, unknown>): void {
    this.payloads.set(code, payload);
  }

  async exchangeCode(
    code: string,
    codeVerifier: string,
  ): Promise<Record<string, unknown>> {
    this.lastCodeVerifier = codeVerifier;
    const payload = this.payloads.get(code);
    if (!payload) {
      // Mirrors the real client: bad/unknown code → generic failure.
      throw new Error('bad code');
    }
    return payload;
  }
}

function goodClaims(
  sub: string,
  email: string,
  nonce: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 300,
    nonce,
    sub,
    email,
    email_verified: true,
    given_name: 'Goog',
    family_name: 'User',
    ...overrides,
  };
}

describe('M11-W2 — Google OIDC core', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const fake = new FakeGoogleOidcClient();
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let collegeCode: string;
  let originalSettings: unknown;
  const cleanupUserIds: string[] = [];
  let codeCounter = 0;

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret-not-real';
    process.env.OAUTH_REDIRECT_BASE = 'http://127.0.0.1:4000';

    app = await createTestApp([{ token: GOOGLE_OIDC_CLIENT, value: fake }]);
    prisma = app.get(PrismaService);
    app.get(LoginRateLimiterService).reset();
    http = request(app.getHttpServer());

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
      include: { college: true },
    });
    collegeId = admin.collegeId;
    collegeCode = admin.college.code;
    originalSettings = admin.college.settings;
    await setMode('additive', true);
  });

  afterAll(async () => {
    await prisma.college.update({
      where: { id: collegeId },
      data: { settings: originalSettings as never },
    });
    await prisma.authIdentity.deleteMany({
      where: { OR: [{ userId: { in: cleanupUserIds } }, { providerSub: { contains: suffix } }] },
    });
    // Only Google-born test users (never the demo accounts) are deleted.
    const bornUsers = await prisma.user.findMany({
      where: { email: { contains: suffix } },
      select: { id: true },
    });
    const bornIds = bornUsers.map((u) => u.id);
    await prisma.refreshToken.deleteMany({ where: { userId: { in: bornIds } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: bornIds } }, { targetId: { in: bornIds } }] },
    });
    await prisma.user.deleteMany({ where: { id: { in: bornIds } } });
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.OAUTH_REDIRECT_BASE;
    await app.close();
  });

  async function setMode(
    googleAuth: 'off' | 'additive' | 'required',
    allowSelfRegistration = false,
  ): Promise<void> {
    await prisma.college.update({
      where: { id: collegeId },
      data: { settings: { googleAuth, allowSelfRegistration } },
    });
  }

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  /** Runs GET /start and extracts everything needed to complete the flow. */
  async function beginFlow(query: string): Promise<{
    cookie: string;
    state: string;
    nonce: string;
    location: string;
    status: number;
  }> {
    const res = await http.get(`/api/v1/auth/google/start${query}`);
    const location = (res.headers.location as string) ?? '';
    const url = location.startsWith('http') ? new URL(location) : null;
    return {
      status: res.status,
      location,
      cookie: cookieValue(res.headers, 'cos_oauth') ?? '',
      state: url?.searchParams.get('state') ?? '',
      nonce: url?.searchParams.get('nonce') ?? '',
    };
  }

  async function callback(
    cookie: string,
    query: Record<string, string>,
  ): Promise<request.Response> {
    const qs = new URLSearchParams(query).toString();
    let req = http.get(`/api/v1/auth/google/callback?${qs}`);
    if (cookie) req = req.set('Cookie', [`cos_oauth=${cookie}`]);
    return req;
  }

  /** Full happy-path flow helper with claim overrides. */
  async function runFlow(
    startQuery: string,
    claimsFor: (nonce: string) => Record<string, unknown>,
  ): Promise<request.Response> {
    const flow = await beginFlow(startQuery);
    expect(flow.status).toBe(302);
    const code = `code-${++codeCounter}-${suffix}`;
    fake.register(code, claimsFor(flow.nonce));
    return callback(flow.cookie, { code, state: flow.state });
  }

  async function trackUser(email: string): Promise<string> {
    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    if (!cleanupUserIds.includes(user.id)) cleanupUserIds.push(user.id);
    return user.id;
  }

  describe('start endpoint', () => {
    it('redirects to Google with PKCE S256, state and nonce', async () => {
      const flow = await beginFlow('?intent=login');
      expect(flow.status).toBe(302);
      const url = new URL(flow.location);
      expect(url.origin + url.pathname).toBe(
        'https://accounts.google.com/o/oauth2/v2/auth',
      );
      expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
      expect(flow.state).toBeTruthy();
      expect(flow.nonce).toBeTruthy();
      expect(flow.cookie).toBeTruthy();
      // Client secret never appears in anything browser-visible.
      expect(flow.location).not.toContain('test-client-secret');
    });

    it('register intent requires a college with self-registration enabled', async () => {
      await setMode('additive', false);
      const denied = await http.get(
        `/api/v1/auth/google/start?intent=register&college=${collegeCode}`,
      );
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('SELF_REGISTRATION_DISABLED');

      const noCollege = await http.get('/api/v1/auth/google/start?intent=register');
      expect(noCollege.status).toBe(400);
      await setMode('additive', true);
    });
  });

  describe('claim validation (each failure is generic)', () => {
    const cases: Array<[string, (nonce: string) => Record<string, unknown>]> = [
      ['invalid issuer', (n) => goodClaims(`s-${suffix}`, 'a@x.dev', n, { iss: 'https://evil.example.com' })],
      ['invalid audience', (n) => goodClaims(`s-${suffix}`, 'a@x.dev', n, { aud: 'other-client' })],
      ['expired id token', (n) => goodClaims(`s-${suffix}`, 'a@x.dev', n, { exp: Math.floor(Date.now() / 1000) - 10 })],
      ['invalid nonce', () => goodClaims(`s-${suffix}`, 'a@x.dev', 'wrong-nonce')],
      ['unverified email', (n) => goodClaims(`s-${suffix}`, 'a@x.dev', n, { email_verified: false })],
    ];
    for (const [name, make] of cases) {
      it(`rejects ${name}`, async () => {
        const res = await runFlow('?intent=login', make);
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/login?error=google_auth_failed');
        expect(cookieValue(res.headers, 'cos_refresh')).toBeUndefined();
      });
    }
  });

  describe('state protection', () => {
    it('rejects a callback without the state cookie', async () => {
      const flow = await beginFlow('?intent=login');
      const code = `code-${++codeCounter}-${suffix}`;
      fake.register(code, goodClaims(`nostate-${suffix}`, 'n@x.dev', flow.nonce));
      const res = await callback('', { code, state: flow.state });
      expect(res.headers.location).toBe('/login?error=google_auth_failed');
    });

    it('rejects a mismatched state parameter', async () => {
      const flow = await beginFlow('?intent=login');
      const res = await callback(flow.cookie, {
        code: 'irrelevant',
        state: 'attacker-supplied-state',
      });
      expect(res.headers.location).toBe('/login?error=google_auth_failed');
    });

    it('rejects a replayed state (one-time use)', async () => {
      const flow = await beginFlow('?intent=login');
      const code = `code-${++codeCounter}-${suffix}`;
      const sub = `replay-${suffix}`;
      fake.register(code, goodClaims(sub, 'replay@x.dev', flow.nonce));

      const first = await callback(flow.cookie, { code, state: flow.state });
      expect(first.status).toBe(302);
      // Same cookie + same state again → refused before any exchange.
      const second = await callback(flow.cookie, { code, state: flow.state });
      expect(second.headers.location).toBe('/login?error=google_auth_failed');
    });

    it('passes the PKCE code_verifier matching the challenge to the exchange', async () => {
      const flow = await beginFlow('?intent=login');
      const code = `code-${++codeCounter}-${suffix}`;
      fake.register(code, goodClaims(`pkce-${suffix}`, 'p@x.dev', flow.nonce));
      await callback(flow.cookie, { code, state: flow.state });
      // The real client would fail the exchange with a wrong verifier; here
      // we assert the verifier flowed through and is high-entropy.
      expect(fake.lastCodeVerifier).toBeTruthy();
      expect((fake.lastCodeVerifier as string).length).toBeGreaterThanOrEqual(43);
    });
  });

  describe('login and linking', () => {
    const teacherSub = `teacher-sub-${suffix}`;
    const studentSub = `student-sub-${suffix}`;

    it('links Google to the logged-in teacher via POST /link + callback', async () => {
      const token = await login('teacher@campusos.dev');
      await trackUser('teacher@campusos.dev');
      const begin = await http
        .post('/api/v1/auth/google/link')
        .set('Authorization', `Bearer ${token}`);
      expect(begin.status).toBe(201);
      const url = new URL(begin.body.data.url);
      const state = url.searchParams.get('state') as string;
      const nonce = url.searchParams.get('nonce') as string;
      const cookie = cookieValue(begin.headers, 'cos_oauth') as string;

      const code = `code-${++codeCounter}-${suffix}`;
      fake.register(code, goodClaims(teacherSub, 'teacher.g@gmail.test', nonce));
      const res = await callback(cookie, { code, state });
      expect(res.headers.location).toBe('/dashboard?googleLink=success');

      const identity = await prisma.authIdentity.findUniqueOrThrow({
        where: { provider_providerSub: { provider: 'GOOGLE', providerSub: teacherSub } },
      });
      expect(identity.emailAtLink).toBe('teacher.g@gmail.test');
    });

    it('Google login succeeds for the linked teacher (existing session path)', async () => {
      const res = await runFlow('?intent=login', (n) =>
        goodClaims(teacherSub, 'teacher.g@gmail.test', n),
      );
      expect(res.headers.location).toBe('/dashboard');
      const refresh = cookieValue(res.headers, 'cos_refresh');
      expect(refresh).toBeTruthy();
      // The refresh cookie works against the normal refresh endpoint —
      // single shared session architecture.
      const refreshed = await http
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`cos_refresh=${refresh}`]);
      expect(refreshed.status).toBe(200);
      expect(refreshed.body.data.user.email).toBe('teacher@campusos.dev');
    });

    it('audits auth.google_login and auth.google_linked', async () => {
      const teacher = await prisma.user.findFirstOrThrow({
        where: { email: 'teacher@campusos.dev' },
      });
      const actions = (
        await prisma.auditLog.findMany({
          where: { actorId: teacher.id, action: { startsWith: 'auth.google' } },
          select: { action: true },
        })
      ).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining(['auth.google_linked', 'auth.google_login']),
      );
    });

    it('links Google to the demo student and logs in (additive mode)', async () => {
      const token = await login('student@campusos.dev');
      await trackUser('student@campusos.dev');
      const begin = await http
        .post('/api/v1/auth/google/link')
        .set('Authorization', `Bearer ${token}`);
      const url = new URL(begin.body.data.url);
      const cookie = cookieValue(begin.headers, 'cos_oauth') as string;
      const code = `code-${++codeCounter}-${suffix}`;
      fake.register(
        code,
        goodClaims(studentSub, 'student.g@gmail.test', url.searchParams.get('nonce') as string),
      );
      const linked = await callback(cookie, {
        code,
        state: url.searchParams.get('state') as string,
      });
      expect(linked.headers.location).toBe('/dashboard?googleLink=success');

      const loginRes = await runFlow('?intent=login', (n) =>
        goodClaims(studentSub, 'student.g@gmail.test', n),
      );
      expect(loginRes.headers.location).toBe('/dashboard');
    });

    it('the same Google sub cannot be linked to a second user', async () => {
      const token = await login('admin@campusos.dev');
      await trackUser('admin@campusos.dev');
      const begin = await http
        .post('/api/v1/auth/google/link')
        .set('Authorization', `Bearer ${token}`);
      const url = new URL(begin.body.data.url);
      const cookie = cookieValue(begin.headers, 'cos_oauth') as string;
      const code = `code-${++codeCounter}-${suffix}`;
      // Admin tries to link the TEACHER's Google sub.
      fake.register(
        code,
        goodClaims(teacherSub, 'teacher.g@gmail.test', url.searchParams.get('nonce') as string),
      );
      const res = await callback(cookie, {
        code,
        state: url.searchParams.get('state') as string,
      });
      expect(res.headers.location).toBe('/dashboard?googleLink=already_linked');
      const count = await prisma.authIdentity.count({
        where: { providerSub: teacherSub },
      });
      expect(count).toBe(1);
    });

    it('a user cannot begin a second link once linked', async () => {
      const token = await login('teacher@campusos.dev');
      const res = await http
        .post('/api/v1/auth/google/link')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GOOGLE_ALREADY_LINKED');
    });

    it('email match alone never auto-links: unknown sub with a known email is refused', async () => {
      // admin@campusos.dev exists, but this Google account (new sub) was
      // never linked — login must NOT attach by email.
      const res = await runFlow('?intent=login', (n) =>
        goodClaims(`fresh-sub-${suffix}`, 'admin@campusos.dev', n),
      );
      expect(res.headers.location).toBe('/login?error=google_not_linked');
      const identities = await prisma.authIdentity.count({
        where: { providerSub: `fresh-sub-${suffix}` },
      });
      expect(identities).toBe(0);
    });

    it('suspended users are rejected through the shared session path', async () => {
      const teacher = await prisma.user.findFirstOrThrow({
        where: { email: 'teacher@campusos.dev' },
      });
      await prisma.user.update({
        where: { id: teacher.id },
        data: { status: 'SUSPENDED' },
      });
      try {
        const res = await runFlow('?intent=login', (n) =>
          goodClaims(teacherSub, 'teacher.g@gmail.test', n),
        );
        expect(res.headers.location).toBe('/login?error=google_auth_failed');
        expect(cookieValue(res.headers, 'cos_refresh')).toBeUndefined();
      } finally {
        await prisma.user.update({
          where: { id: teacher.id },
          data: { status: 'ACTIVE' },
        });
      }
    });
  });

  describe('self-registration', () => {
    it('creates an UNVERIFIED password-less student and starts a session', async () => {
      await setMode('additive', true);
      const email = `newstudent-${suffix}@gmail.test`;
      const res = await runFlow(
        `?intent=register&college=${collegeCode}`,
        (n) => goodClaims(`reg-sub-${suffix}`, email, n),
      );
      expect(res.headers.location).toBe('/verify');
      expect(cookieValue(res.headers, 'cos_refresh')).toBeTruthy();

      const userId = await trackUser(email);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.role).toBe('STUDENT');
      expect(user.verificationStatus).toBe('UNVERIFIED');
      expect(user.passwordHash).toBeNull();
      expect(user.collegeId).toBe(collegeId);
    });

    it('registering again with the same Google account just logs in', async () => {
      const res = await runFlow(
        `?intent=register&college=${collegeCode}`,
        (n) => goodClaims(`reg-sub-${suffix}`, `newstudent-${suffix}@gmail.test`, n),
      );
      expect(res.headers.location).toBe('/dashboard');
      const count = await prisma.user.count({
        where: { email: `newstudent-${suffix}@gmail.test` },
      });
      expect(count).toBe(1);
    });

    it('registration with an email already used in the college is refused without linking', async () => {
      const res = await runFlow(
        `?intent=register&college=${collegeCode}`,
        (n) => goodClaims(`squatter-${suffix}`, 'admin@campusos.dev', n),
      );
      expect(res.headers.location).toBe('/login?error=registration_unavailable');
      expect(
        await prisma.authIdentity.count({ where: { providerSub: `squatter-${suffix}` } }),
      ).toBe(0);
    });
  });

  describe('unlink protection', () => {
    it('a password-less account cannot unlink (no fallback credential)', async () => {
      // The self-registered student from above: password-less by design.
      // It has no password login, so exercise unlink via a fresh Google
      // login session.
      const loginRes = await runFlow('?intent=login', (n) =>
        goodClaims(`reg-sub-${suffix}`, `newstudent-${suffix}@gmail.test`, n),
      );
      const refresh = cookieValue(loginRes.headers, 'cos_refresh') as string;
      const session = await http
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`cos_refresh=${refresh}`]);
      const token = session.body.data.accessToken as string;

      const res = await http
        .delete('/api/v1/auth/google/link')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('UNLINK_NO_PASSWORD');
    });

    it('students cannot unlink in required mode; unlink works in additive', async () => {
      await setMode('required');
      const token = await login('student@campusos.dev');
      const denied = await http
        .delete('/api/v1/auth/google/link')
        .set('Authorization', `Bearer ${token}`);
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('GOOGLE_REQUIRED');

      await setMode('additive', true);
      const ok = await http
        .delete('/api/v1/auth/google/link')
        .set('Authorization', `Bearer ${token}`);
      expect(ok.status).toBe(200);
      expect(ok.body.data.unlinked).toBe(true);

      const student = await prisma.user.findFirstOrThrow({
        where: { email: 'student@campusos.dev' },
      });
      const audit = await prisma.auditLog.findFirst({
        where: { actorId: student.id, action: 'auth.google_unlinked' },
      });
      expect(audit).not.toBeNull();
    });
  });

  describe('feature flags and regression', () => {
    it('googleAuth=off: linked users cannot Google-login into that college', async () => {
      await setMode('off');
      const res = await runFlow('?intent=login', (n) =>
        goodClaims(teacherSubRef(), 'teacher.g@gmail.test', n),
      );
      expect(res.headers.location).toBe('/login?error=google_disabled');
      await setMode('additive', true);
    });

    it('admin/teacher/student password login still works in additive mode', async () => {
      app.get(LoginRateLimiterService).reset();
      for (const email of [
        'admin@campusos.dev',
        'teacher@campusos.dev',
        'student@campusos.dev',
      ]) {
        const res = await http
          .post('/api/v1/auth/login')
          .send({ email, password: DEMO_PASSWORD });
        expect(res.status).toBe(200);
      }
    });

    it('link status endpoint requires auth and exposes no Google config', async () => {
      expect((await http.get('/api/v1/auth/google/link')).status).toBe(401);
      const token = await login('teacher@campusos.dev');
      const res = await http
        .get('/api/v1/auth/google/link')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        available: true,
        linked: true,
        emailAtLink: 'teacher.g@gmail.test',
      });
      expect(JSON.stringify(res.body)).not.toContain('test-client-secret');
      expect(JSON.stringify(res.body)).not.toContain(CLIENT_ID);
    });
  });

  function teacherSubRef(): string {
    return `teacher-sub-${suffix}`;
  }
});

describe('M11-W2 — Google feature disabled (no env config)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.OAUTH_REDIRECT_BASE;
    app = await createTestApp();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  it('start and callback fail safely with FEATURE_DISABLED', async () => {
    const start = await http.get('/api/v1/auth/google/start?intent=login');
    expect(start.status).toBe(503);
    expect(start.body.error.code).toBe('FEATURE_DISABLED');

    const cb = await http.get('/api/v1/auth/google/callback?code=x&state=y');
    expect(cb.status).toBe(503);
  });

  it('password login is completely unaffected', async () => {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email: 'admin@campusos.dev', password: 'CampusOS!demo1' });
    expect(res.status).toBe(200);
  });
});
