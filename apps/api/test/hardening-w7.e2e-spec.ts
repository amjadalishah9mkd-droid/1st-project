import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { RateLimiterService, RATE_POLICIES } from '../src/common/rate-limiter.service';
import { EvidenceRetentionService } from '../src/verification/evidence-retention.service';
import { LocalStorageAdapter } from '../src/files/storage.adapter';
import { GOOGLE_OIDC_CLIENT } from '../src/auth/google/google-oidc.client';
import { createTestApp, cookieValue } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';
const CLIENT_ID = 'w7-client-id.apps.googleusercontent.com';
const PNG = Buffer.concat([
  Buffer.from('\x89PNG\r\n\x1a\n', 'binary'),
  Buffer.alloc(24, 9),
]);

class FakeGoogleOidcClient {
  payloads = new Map<string, Record<string, unknown>>();
  register(code: string, payload: Record<string, unknown>): void {
    this.payloads.set(code, payload);
  }
  async exchangeCode(code: string): Promise<Record<string, unknown>> {
    const payload = this.payloads.get(code);
    if (!payload) throw new Error('bad code');
    return payload;
  }
}

function goodClaims(sub: string, email: string, nonce: string) {
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 300,
    nonce,
    sub,
    email,
    email_verified: true,
    given_name: 'W7',
    family_name: 'Test',
  };
}

/**
 * M11-W7 — production hardening: DB-backed one-time OAuth state (multi-
 * instance), explicit rate-limit policies, evidence retention, required-
 * mode cutover, and college settings management.
 */
describe('M11-W7 — hardening', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const fake = new FakeGoogleOidcClient();
  const suffix = Date.now().toString(36);
  let collegeId: string;
  const madeUserIds: string[] = [];
  let codeCounter = 0;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function limiter(): RateLimiterService {
    return app.get(RateLimiterService);
  }

  async function login(email: string, password = DEMO_PASSWORD) {
    app.get(LoginRateLimiterService).reset();
    return http.post('/api/v1/auth/login').send({ email, password });
  }

  async function loginToken(email: string, password = DEMO_PASSWORD): Promise<string> {
    const res = await login(email, password);
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function makeStudent(tag: string, withProfile = true) {
    const argon2 = await import('argon2');
    const user = await prisma.user.create({
      data: {
        college: { connect: { id: collegeId } },
        email: `w7-${tag}-${suffix}@campusos.dev`,
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        role: 'STUDENT',
        verificationStatus: 'VERIFIED',
        firstName: 'W7',
        lastName: tag,
        mustChangePassword: false,
      },
    });
    madeUserIds.push(user.id);
    let profile = null;
    if (withProfile) {
      const department = await prisma.department.findFirstOrThrow({
        where: { collegeId },
      });
      profile = await prisma.studentProfile.create({
        data: {
          user: { connect: { id: user.id } },
          college: { connect: { id: collegeId } },
          department: { connect: { id: department.id } },
          admissionNo: `W7-${tag}-${suffix}`,
          rollNo: `W7R-${tag}-${suffix}`,
          batch: '2026',
        },
      });
    }
    return { user, profile };
  }

  async function setMode(googleAuth: 'off' | 'additive' | 'required') {
    await prisma.college.update({
      where: { id: collegeId },
      data: { settings: { googleAuth } },
    });
  }

  async function uploadEvidence(token: string) {
    return http
      .post('/api/v1/verification/evidence')
      .set(auth(token))
      .attach('file', PNG, 'w7.png');
  }

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    process.env.GOOGLE_CLIENT_SECRET = 'w7-secret-not-real';
    process.env.OAUTH_REDIRECT_BASE = 'http://127.0.0.1:4000';
    app = await createTestApp([{ token: GOOGLE_OIDC_CLIENT, value: fake }]);
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());
    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
  });

  afterAll(async () => {
    await prisma.college.update({
      where: { id: collegeId },
      data: { settings: {} },
    });
    await prisma.studentIdentityClaim.deleteMany({
      where: { userId: { in: madeUserIds } },
    });
    await prisma.evidenceFile.deleteMany({
      where: { uploaderId: { in: madeUserIds } },
    });
    await prisma.notification.deleteMany({ where: { userId: { in: madeUserIds } } });
    await prisma.studentProfile.deleteMany({
      where: { userId: { in: madeUserIds } },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ actorId: { in: madeUserIds } }, { targetId: { in: madeUserIds } }],
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: madeUserIds } } });
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.OAUTH_REDIRECT_BASE;
    await app.close();
  });

  describe('OAuth state: DB-backed one-time consumption (W7.1)', () => {
    it('a consumed state is recorded as a hash, never plaintext', async () => {
      await setMode('additive');
      const start = await http.get('/api/v1/auth/google/start?intent=login');
      const url = new URL(start.headers.location as string);
      const state = url.searchParams.get('state') as string;
      const code = `w7code-${++codeCounter}`;
      fake.register(code, goodClaims(`w7-sub-a-${suffix}`, 'a@x.dev', 'nope'));
      await http
        .get(`/api/v1/auth/google/callback?code=${code}&state=${state}`)
        .set('Cookie', [`cos_oauth=${cookieValue(start.headers, 'cos_oauth')}`]);

      const rows = await prisma.oauthStateConsumption.findMany();
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const row of rows) {
        expect(row.stateHash).toMatch(/^[0-9a-f]{64}$/);
        expect(row.stateHash).not.toBe(state);
      }
    });

    it('replay is refused even on a DIFFERENT API instance sharing the DB', async () => {
      const app2 = await createTestApp([{ token: GOOGLE_OIDC_CLIENT, value: fake }]);
      const http2 = request(app2.getHttpServer());
      try {
        const start = await http.get('/api/v1/auth/google/start?intent=login');
        const url = new URL(start.headers.location as string);
        const state = url.searchParams.get('state') as string;
        const nonce = url.searchParams.get('nonce') as string;
        const cookie = cookieValue(start.headers, 'cos_oauth') as string;
        const code = `w7code-${++codeCounter}`;
        fake.register(code, goodClaims(`w7-sub-b-${suffix}`, 'b@x.dev', nonce));

        // First use on instance 1 (unknown sub → not_linked, but state is consumed).
        const first = await http
          .get(`/api/v1/auth/google/callback?code=${code}&state=${state}`)
          .set('Cookie', [`cos_oauth=${cookie}`]);
        expect(first.headers.location).toBe('/login?error=google_not_linked');

        // Replay on instance 2: without the DB store this would pass.
        const replay = await http2
          .get(`/api/v1/auth/google/callback?code=${code}&state=${state}`)
          .set('Cookie', [`cos_oauth=${cookie}`]);
        expect(replay.headers.location).toBe('/login?error=google_auth_failed');
      } finally {
        await app2.close();
      }
    });

    it('expired consumption records are swept', async () => {
      await prisma.oauthStateConsumption.create({
        data: {
          stateHash: 'e'.repeat(64),
          expiresAt: new Date(Date.now() - 60_000),
        },
      });
      await app.get(EvidenceRetentionService).runSweep();
      expect(
        await prisma.oauthStateConsumption.count({
          where: { stateHash: 'e'.repeat(64) },
        }),
      ).toBe(0);
    });
  });

  describe('rate limiting (W7.2)', () => {
    it('invite-info is limited per IP with the standard envelope', async () => {
      limiter().reset();
      let limited: request.Response | null = null;
      for (let i = 0; i <= RATE_POLICIES.inviteInfo.limit; i += 1) {
        const res = await http.get('/api/v1/auth/invite-info?token=deadbeef');
        if (res.status === 429) {
          limited = res;
          break;
        }
        expect(res.status).toBe(400); // invalid token, but not limited yet
      }
      expect(limited).not.toBeNull();
      expect(limited!.body.error.code).toBe('RATE_LIMITED');
      limiter().reset();
    });

    it('evidence uploads are limited per user; another user is unaffected', async () => {
      limiter().reset();
      const a = await makeStudent('lim-a', false);
      const b = await makeStudent('lim-b', false);
      // Lifecycle: VERIFIED students hold verification.submit? They do —
      // permission is role-based; lifecycle gate allows VERIFIED fully.
      const tokenA = await loginToken(a.user.email);
      const tokenB = await loginToken(b.user.email);

      let sawLimit = false;
      for (let i = 0; i < RATE_POLICIES.evidenceUpload.limit + 1; i += 1) {
        const res = await uploadEvidence(tokenA);
        if (res.status === 429) {
          expect(res.body.error.code).toBe('RATE_LIMITED');
          sawLimit = true;
          break;
        }
        expect(res.status).toBe(201);
      }
      expect(sawLimit).toBe(true);

      // Per-user keying: user B still uploads fine.
      expect((await uploadEvidence(tokenB)).status).toBe(201);
      limiter().reset();
    });

    it('claim submissions are limited per user', async () => {
      limiter().reset();
      const { user } = await makeStudent('lim-c', false);
      await prisma.user.update({
        where: { id: user.id },
        data: { verificationStatus: 'UNVERIFIED' },
      });
      const token = await loginToken(user.email);
      const up = await uploadEvidence(token);
      let sawLimit = false;
      for (let i = 0; i < RATE_POLICIES.claimSubmit.limit + 1; i += 1) {
        const res = await http
          .post('/api/v1/verification/claims')
          .set(auth(token))
          .send({
            claimedAdmissionNo: `L-${i}`,
            evidenceFileKey: up.body.data.evidenceFileKey,
          });
        if (res.status === 429) {
          expect(res.body.error.code).toBe('RATE_LIMITED');
          sawLimit = true;
          break;
        }
      }
      expect(sawLimit).toBe(true);
      limiter().reset();
    });

    it('login failure backoff (M1 limiter) still behaves as before', async () => {
      const rl = app.get(LoginRateLimiterService);
      rl.reset();
      for (let i = 0; i < 5; i += 1) {
        await http
          .post('/api/v1/auth/login')
          .send({ email: `w7-nobody-${suffix}@x.dev`, password: 'WrongPass1x' });
      }
      const blocked = await http
        .post('/api/v1/auth/login')
        .send({ email: `w7-nobody-${suffix}@x.dev`, password: 'WrongPass1x' });
      expect(blocked.status).toBe(429);
      rl.reset();
    });
  });

  describe('evidence retention (W7.3, policy R3)', () => {
    async function evidenceWithClaim(
      tag: string,
      status: 'APPROVED' | 'CANCELLED' | 'REJECTED',
      decidedDaysAgo: number,
    ) {
      limiter().reset();
      const { user, profile } = await makeStudent(`ret-${tag}`);
      const token = await loginToken(user.email);
      const up = await uploadEvidence(token);
      const key = up.body.data.evidenceFileKey as string;
      const decidedAt = new Date(Date.now() - decidedDaysAgo * 24 * 60 * 60 * 1000);
      const claim = await prisma.studentIdentityClaim.create({
        data: {
          collegeId,
          userId: user.id,
          studentProfileId: profile!.id,
          claimedAdmissionNo: profile!.admissionNo,
          evidenceFileKey: key,
          status,
          decidedAt: status === 'CANCELLED' ? null : decidedAt,
          rejectionReason: status === 'REJECTED' ? 'kept' : null,
        },
      });
      return { key, claim };
    }

    it('purges per policy: approved>30d and cancelled go, rejected and fresh stay', async () => {
      const storage = app.get(LocalStorageAdapter);
      const oldApproved = await evidenceWithClaim('olda', 'APPROVED', 31);
      const freshApproved = await evidenceWithClaim('fresh', 'APPROVED', 5);
      const cancelled = await evidenceWithClaim('canc', 'CANCELLED', 0);
      const rejected = await evidenceWithClaim('rej', 'REJECTED', 90);

      // Orphan (no claim reference), backdated 8 days.
      limiter().reset();
      const { user: orphanUser } = await makeStudent('orphan', false);
      const orphanToken = await loginToken(orphanUser.email);
      const orphanUp = await uploadEvidence(orphanToken);
      const orphanKey = orphanUp.body.data.evidenceFileKey as string;
      await prisma.evidenceFile.update({
        where: { key: orphanKey },
        data: { createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
      });

      const purged = await app.get(EvidenceRetentionService).runSweep();
      expect(purged).toBeGreaterThanOrEqual(3);

      // Purged: DB row gone AND binary gone.
      for (const key of [oldApproved.key, cancelled.key, orphanKey]) {
        expect(await prisma.evidenceFile.findUnique({ where: { key } })).toBeNull();
        expect(await storage.open(key)).toBeNull();
      }
      // Retained: fresh approved + rejected.
      for (const key of [freshApproved.key, rejected.key]) {
        expect(await prisma.evidenceFile.findUnique({ where: { key } })).not.toBeNull();
        expect(await storage.open(key)).not.toBeNull();
      }
      // Claim history and its evidenceFileKey string are preserved.
      const claimAfter = await prisma.studentIdentityClaim.findUniqueOrThrow({
        where: { id: oldApproved.claim.id },
      });
      expect(claimAfter.status).toBe('APPROVED');
      expect(claimAfter.evidenceFileKey).toBe(oldApproved.key);
      // Audit trail for the purge (system action, no actor).
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'verification.evidence_purged',
          metadata: { path: ['reason'], equals: 'approved_retention_elapsed' },
        },
      });
      expect(audit).not.toBeNull();
      expect(audit!.actorId).toBeNull();
    });

    it('the sweep is idempotent', async () => {
      const again = await app.get(EvidenceRetentionService).runSweep();
      expect(again).toBe(0);
    });
  });

  describe('required-mode cutover (W7.4, decisions R1/D6)', () => {
    it('valid password login is refused for student-profile owners with USE_GOOGLE_LOGIN', async () => {
      await setMode('required');
      const { user } = await makeStudent('cut');
      const res = await login(user.email);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('USE_GOOGLE_LOGIN');

      const audit = await prisma.auditLog.findFirst({
        where: { targetId: user.id, action: 'auth.login.failure' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit?.metadata).toMatchObject({ reason: 'google_required' });
    });

    it('wrong passwords stay generic 401 (no student-account oracle)', async () => {
      const { user } = await makeStudent('cutwrong');
      const res = await login(user.email, 'WrongPassword1x');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('LEGACY student-profile owners are equally blocked (R1: ALL owners)', async () => {
      const { user } = await makeStudent('cutlegacy');
      await prisma.user.update({
        where: { id: user.id },
        data: { verificationStatus: 'LEGACY' },
      });
      const res = await login(user.email);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('USE_GOOGLE_LOGIN');
    });

    it('teachers/admins (no student profile) are unaffected; Google login still works', async () => {
      expect((await login('admin@campusos.dev')).status).toBe(200);
      expect((await login('teacher@campusos.dev')).status).toBe(200);

      // Google path for a linked student keeps working in required mode.
      const { user } = await makeStudent('cutgoog');
      await prisma.authIdentity.create({
        data: {
          userId: user.id,
          provider: 'GOOGLE',
          providerSub: `w7-cut-sub-${suffix}`,
          emailAtLink: user.email,
        },
      });
      const start = await http.get('/api/v1/auth/google/start?intent=login');
      const url = new URL(start.headers.location as string);
      const code = `w7code-${++codeCounter}`;
      fake.register(
        code,
        goodClaims(`w7-cut-sub-${suffix}`, user.email, url.searchParams.get('nonce') as string),
      );
      const cb = await http
        .get(`/api/v1/auth/google/callback?code=${code}&state=${url.searchParams.get('state')}`)
        .set('Cookie', [`cos_oauth=${cookieValue(start.headers, 'cos_oauth')}`]);
      expect(cb.headers.location).toBe('/dashboard');
    });

    it('additive/off modes leave student password login untouched', async () => {
      const { user } = await makeStudent('cutback');
      await setMode('additive');
      expect((await login(user.email)).status).toBe(200);
      await setMode('off');
      expect((await login(user.email)).status).toBe(200);
    });
  });

  describe('college settings API (W7.5, decision R2)', () => {
    it('admin reads and patches settings; change is merged, audited, tenant-scoped', async () => {
      await prisma.college.update({
        where: { id: collegeId },
        data: { settings: { theme: 'dark' } }, // unknown key must survive
      });
      const adminToken = await loginToken('admin@campusos.dev');
      const before = await http
        .get('/api/v1/settings/college')
        .set(auth(adminToken));
      expect(before.status).toBe(200);
      expect(before.body.data.settings.googleAuth).toBe('off');

      const patch = await http
        .patch('/api/v1/settings/college')
        .set(auth(adminToken))
        .send({ googleAuth: 'additive', googleAuthGraceDays: 14 });
      expect(patch.status).toBe(200);
      expect(patch.body.data.settings.googleAuth).toBe('additive');
      expect(patch.body.data.settings.googleAuthGraceDays).toBe(14);

      const college = await prisma.college.findUniqueOrThrow({
        where: { id: collegeId },
      });
      expect((college.settings as Record<string, unknown>).theme).toBe('dark');

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'settings.updated', collegeId },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit?.metadata).toMatchObject({
        changed: ['googleAuth', 'googleAuthGraceDays'],
      });
      await setMode('off');
    });

    it('requires settings.manage and validates input', async () => {
      const teacherToken = await loginToken('teacher@campusos.dev');
      expect(
        (await http.get('/api/v1/settings/college').set(auth(teacherToken))).status,
      ).toBe(403);
      const adminToken = await loginToken('admin@campusos.dev');
      const bad = await http
        .patch('/api/v1/settings/college')
        .set(auth(adminToken))
        .send({ googleAuth: 'sometimes' });
      expect(bad.status).toBe(400);
      const unknown = await http
        .patch('/api/v1/settings/college')
        .set(auth(adminToken))
        .send({ hacked: true });
      expect(unknown.status).toBe(400); // strict schema
    });
  });
});
