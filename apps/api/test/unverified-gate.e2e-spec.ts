import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';
const PNG = Buffer.concat([
  Buffer.from('\x89PNG\r\n\x1a\n', 'binary'),
  Buffer.alloc(16, 1),
]);

/**
 * M11-W5 — identity lifecycle gate + onboarding surface.
 * Unverified-lifecycle accounts (UNVERIFIED/PENDING/REJECTED) may only
 * exercise verification.submit; LEGACY and VERIFIED accounts are
 * unaffected. Enforced by PolicyService — the single authorization path.
 */
describe('M11-W5 — unverified lifecycle gate', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let collegeId: string;
  const madeUserIds: string[] = [];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function makeStudent(
    tag: string,
    verificationStatus: 'UNVERIFIED' | 'PENDING' | 'REJECTED' | 'VERIFIED',
  ) {
    const argon2 = await import('argon2');
    const user = await prisma.user.create({
      data: {
        college: { connect: { id: collegeId } },
        email: `w5-${tag}-${suffix}@campusos.dev`,
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        role: 'STUDENT',
        verificationStatus,
        firstName: 'W5',
        lastName: tag,
        mustChangePassword: false,
      },
    });
    madeUserIds.push(user.id);
    return { user, token: await login(user.email) };
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());
    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
  });

  afterAll(async () => {
    await prisma.studentIdentityClaim.deleteMany({
      where: { userId: { in: madeUserIds } },
    });
    await prisma.evidenceFile.deleteMany({
      where: { uploaderId: { in: madeUserIds } },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ actorId: { in: madeUserIds } }, { targetId: { in: madeUserIds } }],
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: madeUserIds } } });
    await app.close();
  });

  it('UNVERIFIED students are denied normal student permissions', async () => {
    const { token } = await makeStudent('unv', 'UNVERIFIED');
    for (const path of ['/assignments', '/results', '/timetable/mine']) {
      const res = await http.get(`/api/v1${path}`).set(auth(token));
      expect([403, 404]).toContain(res.status);
      expect(res.status).not.toBe(200);
    }
  });

  it('UNVERIFIED students can still use the verification surface', async () => {
    const { token } = await makeStudent('unv2', 'UNVERIFIED');
    const up = await http
      .post('/api/v1/verification/evidence')
      .set(auth(token))
      .attach('file', PNG, 'card.png');
    expect(up.status).toBe(201);
    const mine = await http
      .get('/api/v1/verification/claims/me')
      .set(auth(token));
    expect(mine.status).toBe(200);
    // /me works (needed by the /verify page) and exposes the lifecycle.
    const me = await http.get('/api/v1/me').set(auth(token));
    expect(me.status).toBe(200);
    expect(me.body.data.verificationStatus).toBe('UNVERIFIED');
  });

  it('PENDING and REJECTED are gated identically', async () => {
    for (const state of ['PENDING', 'REJECTED'] as const) {
      const { token } = await makeStudent(`g-${state.toLowerCase()}`, state);
      expect(
        (await http.get('/api/v1/assignments').set(auth(token))).status,
      ).toBe(403);
      expect(
        (await http.get('/api/v1/verification/claims/me').set(auth(token)))
          .status,
      ).toBe(200);
    }
  });

  it('VERIFIED students have full student permissions', async () => {
    const { token } = await makeStudent('ver', 'VERIFIED');
    expect((await http.get('/api/v1/assignments').set(auth(token))).status).toBe(
      200,
    );
  });

  it('LEGACY accounts (all demo users) are completely unaffected', async () => {
    const studentToken = await login('student@campusos.dev');
    expect(
      (await http.get('/api/v1/assignments').set(auth(studentToken))).status,
    ).toBe(200);
    const teacherToken = await login('teacher@campusos.dev');
    expect(
      (await http.get('/api/v1/assignments').set(auth(teacherToken))).status,
    ).toBe(200);
  });

  it('GET /auth/config is public and exposes only booleans', async () => {
    const res = await http.get('/api/v1/auth/config');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ google: false }); // no env in this suite
    process.env.GOOGLE_CLIENT_ID = 'x.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'x-secret';
    process.env.OAUTH_REDIRECT_BASE = 'http://127.0.0.1:4000';
    try {
      const enabled = await http.get('/api/v1/auth/config');
      expect(enabled.body.data).toEqual({ google: true });
      expect(JSON.stringify(enabled.body)).not.toContain('googleusercontent');
    } finally {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.OAUTH_REDIRECT_BASE;
    }
  });

  it('session hint cookie carries the verification state (v)', async () => {
    const { user } = await makeStudent('hint', 'UNVERIFIED');
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: DEMO_PASSWORD });
    const raw = (res.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('cos_auth='))!
      .split(';')[0]
      .slice('cos_auth='.length);
    const hint = JSON.parse(
      Buffer.from(decodeURIComponent(raw), 'base64url').toString('utf8'),
    );
    expect(hint).toMatchObject({ r: 'STUDENT', v: 'UNVERIFIED' });
    expect(JSON.stringify(hint)).not.toContain('token');
  });
});
