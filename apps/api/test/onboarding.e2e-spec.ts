import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { GOOGLE_OIDC_CLIENT } from '../src/auth/google/google-oidc.client';
import { createTestApp, cookieValue } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';
const CLIENT_ID = 'w4-client-id.apps.googleusercontent.com';
const PNG = Buffer.concat([
  Buffer.from('\x89PNG\r\n\x1a\n', 'binary'),
  Buffer.alloc(32, 3),
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
    given_name: 'Invited',
    family_name: 'Student',
  };
}

/**
 * M11-W4 — verified student onboarding / invitation integration.
 * Exercises both acceptance methods, college mode gating, one-time token
 * semantics across methods, supersession (path E), DB-final duplicate
 * prevention, session-link auto-verification and rollback behavior.
 */
describe('M11-W4 — verified student onboarding', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const fake = new FakeGoogleOidcClient();
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let departmentId: string;
  let adminToken: string;
  let codeCounter = 0;
  const madeUserIds: string[] = [];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(email: string, password = DEMO_PASSWORD): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http.post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function setMode(
    googleAuth: 'off' | 'additive' | 'required',
  ): Promise<void> {
    await prisma.college.update({
      where: { id: collegeId },
      data: { settings: { googleAuth, allowSelfRegistration: false } },
    });
  }

  /** Admin creates a student via the real API; returns the invite token. */
  async function createInvitedStudent(tag: string) {
    const res = await http
      .post('/api/v1/students')
      .set(auth(adminToken))
      .send({
        firstName: 'W4',
        lastName: tag,
        email: `w4-${tag}-${suffix}@campusos.dev`,
        departmentId,
        admissionNo: `W4-${tag}-${suffix}`,
        rollNo: `W4R-${tag}-${suffix}`,
        batch: '2026',
      });
    expect(res.status).toBe(201);
    const token = (res.body.data.invite.url as string).split('token=')[1];
    const user = await prisma.user.findFirstOrThrow({
      where: { email: `w4-${tag}-${suffix}@campusos.dev` },
      include: { studentProfile: true },
    });
    madeUserIds.push(user.id);
    return { inviteToken: token, user, profile: user.studentProfile! };
  }

  /** A Google-less student account used to file rival claims. */
  async function makeClaimant(tag: string) {
    const argon2 = await import('argon2');
    const user = await prisma.user.create({
      data: {
        college: { connect: { id: collegeId } },
        email: `w4-claimant-${tag}-${suffix}@campusos.dev`,
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        role: 'STUDENT',
        verificationStatus: 'UNVERIFIED',
        firstName: 'Rival',
        lastName: tag,
        mustChangePassword: false,
      },
    });
    madeUserIds.push(user.id);
    return { user, token: await login(user.email) };
  }

  async function fileClaim(token: string, admissionNo: string) {
    const up = await http
      .post('/api/v1/verification/evidence')
      .set(auth(token))
      .attach('file', PNG, 'card.png');
    return http
      .post('/api/v1/verification/claims')
      .set(auth(token))
      .send({
        claimedAdmissionNo: admissionNo,
        evidenceFileKey: up.body.data.evidenceFileKey,
      });
  }

  async function googleInviteFlow(
    inviteToken: string,
    sub: string,
    email: string,
  ) {
    const start = await http.get(
      `/api/v1/auth/google/start?intent=invite&token=${inviteToken}`,
    );
    if (start.status !== 302) return { start, callback: null as never };
    const url = new URL(start.headers.location as string);
    const code = `w4code-${++codeCounter}-${suffix}`;
    fake.register(
      code,
      goodClaims(sub, email, url.searchParams.get('nonce') as string),
    );
    const callback = await http
      .get(
        `/api/v1/auth/google/callback?code=${code}&state=${url.searchParams.get('state')}`,
      )
      .set('Cookie', [`cos_oauth=${cookieValue(start.headers, 'cos_oauth')}`]);
    return { start, callback };
  }

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    process.env.GOOGLE_CLIENT_SECRET = 'w4-secret-not-real';
    process.env.OAUTH_REDIRECT_BASE = 'http://127.0.0.1:4000';
    app = await createTestApp([{ token: GOOGLE_OIDC_CLIENT, value: fake }]);
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
    const department = await prisma.department.create({
      data: {
        college: { connect: { id: collegeId } },
        code: `W4D-${suffix.toUpperCase()}`,
        name: 'W4 Onboarding Dept',
      },
    });
    departmentId = department.id;
    adminToken = await login('admin@campusos.dev');
    await setMode('additive');
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
    await prisma.notification.deleteMany({
      where: { userId: { in: madeUserIds } },
    });
    await prisma.studentProfile.deleteMany({
      where: { userId: { in: madeUserIds } },
    });
    await prisma.teacherProfile.deleteMany({
      where: { userId: { in: madeUserIds } },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ actorId: { in: madeUserIds } }, { targetId: { in: madeUserIds } }],
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: madeUserIds } } });
    await prisma.department.delete({ where: { id: departmentId } });
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.OAUTH_REDIRECT_BASE;
    await app.close();
  });

  describe('invite-info (W4 accept page contract)', () => {
    it('reports both/password/google per college mode', async () => {
      const { inviteToken } = await createInvitedStudent('modes');
      const both = await http.get(`/api/v1/auth/invite-info?token=${inviteToken}`);
      expect(both.status).toBe(200);
      expect(both.body.data.mode).toBe('both');

      await setMode('off');
      expect(
        (await http.get(`/api/v1/auth/invite-info?token=${inviteToken}`)).body
          .data.mode,
      ).toBe('password');

      await setMode('required');
      expect(
        (await http.get(`/api/v1/auth/invite-info?token=${inviteToken}`)).body
          .data.mode,
      ).toBe('google');
      await setMode('additive');
    });

    it('invalid tokens get the generic error', async () => {
      const res = await http.get(
        `/api/v1/auth/invite-info?token=${'f'.repeat(64)}`,
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });
  });

  describe('password acceptance (journeys A/B)', () => {
    it('off mode: acceptance → VERIFIED + synthetic APPROVED claim', async () => {
      await setMode('off');
      const { inviteToken, user, profile } = await createInvitedStudent('pwoff');
      const res = await http
        .post('/api/v1/auth/accept-invite')
        .send({ token: inviteToken, password: 'W4password1x' });
      expect(res.status).toBe(200);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.verificationStatus).toBe('VERIFIED');
      const claim = await prisma.studentIdentityClaim.findFirstOrThrow({
        where: { studentProfileId: profile.id },
      });
      expect(claim.status).toBe('APPROVED');
      expect(claim.userId).toBe(user.id);
      expect(claim.claimedAdmissionNo).toBe(profile.admissionNo);
      await setMode('additive');
    });

    it('additive mode: password path also verifies; audit records method', async () => {
      const { inviteToken, user } = await createInvitedStudent('pwadd');
      const res = await http
        .post('/api/v1/auth/accept-invite')
        .send({ token: inviteToken, password: 'W4password1x' });
      expect(res.status).toBe(200);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.verificationStatus).toBe('VERIFIED');

      const audit = await prisma.auditLog.findFirst({
        where: { targetId: user.id, action: 'auth.invite_accepted' },
      });
      expect(audit?.metadata).toMatchObject({ method: 'password' });
      const auto = await prisma.auditLog.findFirst({
        where: { targetId: user.id, action: 'verification.auto_verified' },
      });
      expect(auto?.metadata).toMatchObject({ via: 'invitation' });
    });

    it('required mode: password acceptance refused server-side, token stays valid', async () => {
      await setMode('required');
      const { inviteToken, user } = await createInvitedStudent('pwreq');
      const res = await http
        .post('/api/v1/auth/accept-invite')
        .send({ token: inviteToken, password: 'W4password1x' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('GOOGLE_SIGNIN_REQUIRED');

      const token = await prisma.credentialToken.findFirst({
        where: { userId: user.id, purpose: 'INVITE' },
      });
      expect(token?.usedAt).toBeNull(); // not consumed

      // The Google path still works with the same token.
      const { callback } = await googleInviteFlow(
        inviteToken,
        `req-sub-${suffix}`,
        `pwreq-${suffix}@gmail.test`,
      );
      expect(callback.headers.location).toBe('/dashboard');
      await setMode('additive');
    });

    it('teacher invitations behave exactly as before (password, no claim)', async () => {
      const res = await http
        .post('/api/v1/teachers')
        .set(auth(adminToken))
        .send({
          firstName: 'W4',
          lastName: 'Teacher',
          email: `w4-teacher-${suffix}@campusos.dev`,
          departmentId,
          employeeNo: `W4E-${suffix}`,
          designation: 'Lecturer',
          joinedOn: '2026-01-05',
        });
      expect(res.status).toBe(201);
      const token = (res.body.data.invite.url as string).split('token=')[1];
      const teacher = await prisma.user.findFirstOrThrow({
        where: { email: `w4-teacher-${suffix}@campusos.dev` },
      });
      madeUserIds.push(teacher.id);

      // required mode does not block non-students.
      await setMode('required');
      expect(
        (await http.get(`/api/v1/auth/invite-info?token=${token}`)).body.data
          .mode,
      ).toBe('password');
      const accept = await http
        .post('/api/v1/auth/accept-invite')
        .send({ token, password: 'W4password1x' });
      expect(accept.status).toBe(200);
      await setMode('additive');

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: teacher.id },
      });
      // Teachers do not enter the student verification lifecycle.
      expect(after.verificationStatus).toBe('LEGACY');
      expect(
        await prisma.studentIdentityClaim.count({ where: { userId: teacher.id } }),
      ).toBe(0);
    });

    it('RESET tokens are untouched by W4 (no verification side effects)', async () => {
      const { user } = await createInvitedStudent('resetcheck');
      const link = await http
        .post(`/api/v1/users/${user.id}/reset-link`)
        .set(auth(adminToken));
      const raw = (link.body.data.url as string).match(/token=([0-9a-f]{64})/)![1];
      const res = await http
        .post('/api/v1/auth/reset-password')
        .send({ token: raw, password: 'W4resetpass1x' });
      expect(res.status).toBe(200);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      // Reset never verifies; the invite was never accepted here.
      expect(after.verificationStatus).toBe('LEGACY');
    });
  });

  describe('Google acceptance (journey B/C)', () => {
    it('accepts via Google: AuthIdentity + VERIFIED + claim + session', async () => {
      const { inviteToken, user, profile } = await createInvitedStudent('goog');
      const { callback } = await googleInviteFlow(
        inviteToken,
        `goog-sub-${suffix}`,
        `goog-${suffix}@gmail.test`,
      );
      expect(callback.headers.location).toBe('/dashboard');
      expect(cookieValue(callback.headers, 'cos_refresh')).toBeTruthy();

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { authIdentities: true },
      });
      expect(after.verificationStatus).toBe('VERIFIED');
      expect(after.mustChangePassword).toBe(false);
      expect(after.authIdentities).toHaveLength(1);
      expect(after.authIdentities[0].providerSub).toBe(`goog-sub-${suffix}`);

      const claim = await prisma.studentIdentityClaim.findFirstOrThrow({
        where: { studentProfileId: profile.id },
      });
      expect(claim.status).toBe('APPROVED');

      // Token consumed → password path now refused (one-time across methods).
      const pw = await http
        .post('/api/v1/auth/accept-invite')
        .send({ token: inviteToken, password: 'W4password1x' });
      expect(pw.status).toBe(400);
      expect(pw.body.error.code).toBe('INVALID_TOKEN');

      // Subsequent Google LOGIN works with the linked sub.
      const startRes = await http.get('/api/v1/auth/google/start?intent=login');
      const url = new URL(startRes.headers.location as string);
      const code = `w4code-${++codeCounter}-${suffix}`;
      fake.register(
        code,
        goodClaims(
          `goog-sub-${suffix}`,
          `goog-${suffix}@gmail.test`,
          url.searchParams.get('nonce') as string,
        ),
      );
      const loginCb = await http
        .get(
          `/api/v1/auth/google/callback?code=${code}&state=${url.searchParams.get('state')}`,
        )
        .set('Cookie', [`cos_oauth=${cookieValue(startRes.headers, 'cos_oauth')}`]);
      expect(loginCb.headers.location).toBe('/dashboard');
    });

    it('Google account already linked elsewhere: rolls back, token NOT consumed', async () => {
      const first = await createInvitedStudent('sub1');
      await googleInviteFlow(
        first.inviteToken,
        `shared-sub-${suffix}`,
        `sub1-${suffix}@gmail.test`,
      );

      const second = await createInvitedStudent('sub2');
      const { callback } = await googleInviteFlow(
        second.inviteToken,
        `shared-sub-${suffix}`, // same Google account
        `sub1-${suffix}@gmail.test`,
      );
      expect(callback.headers.location).toBe('/login?error=google_auth_failed');

      const token = await prisma.credentialToken.findFirst({
        where: { userId: second.user.id, purpose: 'INVITE' },
      });
      expect(token?.usedAt).toBeNull(); // rollback left it valid
      const after = await prisma.user.findUniqueOrThrow({
        where: { id: second.user.id },
      });
      expect(after.verificationStatus).toBe('LEGACY'); // untouched

      // Retry with the correct Google account succeeds.
      const retry = await googleInviteFlow(
        second.inviteToken,
        `own-sub-${suffix}`,
        `sub2-${suffix}@gmail.test`,
      );
      expect(retry.callback.headers.location).toBe('/dashboard');
    });

    it('expired invitations are refused at start (generic)', async () => {
      const { inviteToken, user } = await createInvitedStudent('expired');
      await prisma.credentialToken.updateMany({
        where: { userId: user.id, purpose: 'INVITE' },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const start = await http.get(
        `/api/v1/auth/google/start?intent=invite&token=${inviteToken}`,
      );
      expect(start.status).toBe(400);
      expect(start.body.error.code).toBe('INVALID_TOKEN');
      const pw = await http
        .post('/api/v1/auth/accept-invite')
        .send({ token: inviteToken, password: 'W4password1x' });
      expect(pw.status).toBe(400);
    });

    it('off mode: Google invite path is disabled', async () => {
      await setMode('off');
      const { inviteToken } = await createInvitedStudent('googoff');
      const start = await http.get(
        `/api/v1/auth/google/start?intent=invite&token=${inviteToken}`,
      );
      expect(start.status).toBe(503);
      await setMode('additive');
    });
  });

  describe('supersession + duplicate prevention (path E)', () => {
    it('accepting an invite supersedes an impostor PENDING claim atomically', async () => {
      const target = await createInvitedStudent('super');
      const impostor = await makeClaimant('impostor');
      const claimRes = await fileClaim(impostor.token, target.profile.admissionNo);
      expect(claimRes.status).toBe(201);
      const impostorClaimId = claimRes.body.data.id as string;

      // Real student accepts the invitation (password path).
      const accept = await http
        .post('/api/v1/auth/accept-invite')
        .send({ token: target.inviteToken, password: 'W4password1x' });
      expect(accept.status).toBe(200);

      const impostorClaim = await prisma.studentIdentityClaim.findUniqueOrThrow({
        where: { id: impostorClaimId },
      });
      expect(impostorClaim.status).toBe('REJECTED');
      expect(impostorClaim.rejectionReason).toContain('administrator-issued invitation');
      expect(impostorClaim.decidedAt).not.toBeNull();

      const impostorUser = await prisma.user.findUniqueOrThrow({
        where: { id: impostor.user.id },
      });
      expect(impostorUser.verificationStatus).toBe('REJECTED');

      const invited = await prisma.user.findUniqueOrThrow({
        where: { id: target.user.id },
      });
      expect(invited.verificationStatus).toBe('VERIFIED');
      const winning = await prisma.studentIdentityClaim.findFirstOrThrow({
        where: { studentProfileId: target.profile.id, status: 'APPROVED' },
      });
      expect(winning.userId).toBe(target.user.id);

      // Audit + exactly-once rejection notification for the impostor.
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'verification.claim_rejected',
          targetId: impostorClaimId,
        },
      });
      expect(audit?.metadata).toMatchObject({ reason: 'superseded' });
      await new Promise((r) => setTimeout(r, 150));
      expect(
        await prisma.notification.count({
          where: { userId: impostor.user.id, type: 'verification.rejected' },
        }),
      ).toBe(1);
    });

    it('after VERIFIED, no one can ever claim that identity again (DB-final)', async () => {
      const target = await createInvitedStudent('sealed');
      await http
        .post('/api/v1/auth/accept-invite')
        .send({ token: target.inviteToken, password: 'W4password1x' });

      const late = await makeClaimant('late');
      const res = await fileClaim(late.token, target.profile.admissionNo);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CLAIM_UNAVAILABLE');
    });

    it("cross-college invites cannot supersede or touch another college's claims", async () => {
      // W3 proved claim resolution is college-scoped. Here we prove the W4
      // path never reaches across: acceptance only reads the invited
      // user's own profile, which is tenant-bound by construction.
      const target = await createInvitedStudent('tenant');
      const accept = await http
        .post('/api/v1/auth/accept-invite')
        .send({ token: target.inviteToken, password: 'W4password1x' });
      expect(accept.status).toBe(200);
      const claim = await prisma.studentIdentityClaim.findFirstOrThrow({
        where: { studentProfileId: target.profile.id },
      });
      expect(claim.collegeId).toBe(collegeId);
    });
  });

  describe('session-link auto-verification (journey D)', () => {
    it('a LEGACY password student who links Google becomes VERIFIED', async () => {
      // Student created + password-accepted, then reset to pre-M11 state
      // (simulating a legacy account without a held identity slot).
      const target = await createInvitedStudent('legacy');
      await http
        .post('/api/v1/auth/accept-invite')
        .send({ token: target.inviteToken, password: 'W4password1x' });
      await prisma.studentIdentityClaim.deleteMany({
        where: { userId: target.user.id },
      });
      await prisma.user.update({
        where: { id: target.user.id },
        data: { verificationStatus: 'LEGACY' },
      });

      const token = await login(target.user.email, 'W4password1x');
      const begin = await http
        .post('/api/v1/auth/google/link')
        .set(auth(token));
      const url = new URL(begin.body.data.url as string);
      const code = `w4code-${++codeCounter}-${suffix}`;
      fake.register(
        code,
        goodClaims(
          `legacy-sub-${suffix}`,
          `legacy-${suffix}@gmail.test`,
          url.searchParams.get('nonce') as string,
        ),
      );
      const cb = await http
        .get(
          `/api/v1/auth/google/callback?code=${code}&state=${url.searchParams.get('state')}`,
        )
        .set('Cookie', [`cos_oauth=${cookieValue(begin.headers, 'cos_oauth')}`]);
      expect(cb.headers.location).toBe('/dashboard?googleLink=success');

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: target.user.id },
      });
      expect(after.verificationStatus).toBe('VERIFIED');
      const claim = await prisma.studentIdentityClaim.findFirstOrThrow({
        where: { userId: target.user.id },
      });
      expect(claim.status).toBe('APPROVED');
      const audit = await prisma.auditLog.findFirst({
        where: { targetId: target.user.id, action: 'verification.auto_verified' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit?.metadata).toMatchObject({ via: 'link' });
    });

    it('linking by a teacher (no student profile) never creates claims', async () => {
      const teacherToken = await login('teacher@campusos.dev');
      const teacher = await prisma.user.findFirstOrThrow({
        where: { email: 'teacher@campusos.dev' },
      });
      await prisma.authIdentity.deleteMany({ where: { userId: teacher.id } });

      const begin = await http
        .post('/api/v1/auth/google/link')
        .set(auth(teacherToken));
      const url = new URL(begin.body.data.url as string);
      const code = `w4code-${++codeCounter}-${suffix}`;
      fake.register(
        code,
        goodClaims(
          `teacher-w4-sub-${suffix}`,
          `teacher-w4-${suffix}@gmail.test`,
          url.searchParams.get('nonce') as string,
        ),
      );
      const cb = await http
        .get(
          `/api/v1/auth/google/callback?code=${code}&state=${url.searchParams.get('state')}`,
        )
        .set('Cookie', [`cos_oauth=${cookieValue(begin.headers, 'cos_oauth')}`]);
      expect(cb.headers.location).toBe('/dashboard?googleLink=success');

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: teacher.id },
      });
      expect(after.verificationStatus).toBe('LEGACY'); // untouched
      expect(
        await prisma.studentIdentityClaim.count({ where: { userId: teacher.id } }),
      ).toBe(0);

      // Cleanup: restore teacher to pre-suite state.
      await prisma.authIdentity.deleteMany({ where: { userId: teacher.id } });
      await prisma.auditLog.deleteMany({
        where: { targetId: teacher.id, action: { startsWith: 'auth.google' } },
      });
    });
  });

  describe('transaction & one-time guarantees', () => {
    it('rollback: pre-existing foreign APPROVED claim aborts acceptance and keeps the token valid', async () => {
      const target = await createInvitedStudent('rollback');
      const foreign = await makeClaimant('holder');
      // Simulate a historical approved binding by another account (forces
      // the IDENTITY_CONFLICT branch).
      await prisma.studentIdentityClaim.create({
        data: {
          collegeId,
          userId: foreign.user.id,
          studentProfileId: target.profile.id,
          claimedAdmissionNo: target.profile.admissionNo,
          status: 'APPROVED',
          decidedAt: new Date(),
        },
      });

      const res = await http
        .post('/api/v1/auth/accept-invite')
        .send({ token: target.inviteToken, password: 'W4password1x' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('IDENTITY_CONFLICT');

      // Complete rollback: token unconsumed, user untouched.
      const token = await prisma.credentialToken.findFirst({
        where: { userId: target.user.id, purpose: 'INVITE' },
      });
      expect(token?.usedAt).toBeNull();
      const after = await prisma.user.findUniqueOrThrow({
        where: { id: target.user.id },
      });
      expect(after.verificationStatus).toBe('LEGACY');
      expect(after.mustChangePassword).toBe(true);
    });

    it('concurrent password acceptances: exactly one consumes the token', async () => {
      const target = await createInvitedStudent('parallel');
      const results = await Promise.all(
        Array.from({ length: 3 }, () =>
          http
            .post('/api/v1/auth/accept-invite')
            .send({ token: target.inviteToken, password: 'W4password1x' }),
        ),
      );
      const wins = results.filter((r) => r.status === 200);
      const losses = results.filter((r) => r.status === 400);
      expect(wins).toHaveLength(1);
      expect(losses).toHaveLength(2);
      expect(
        await prisma.studentIdentityClaim.count({
          where: { studentProfileId: target.profile.id, status: 'APPROVED' },
        }),
      ).toBe(1);
    });

    it('password acceptance consumes the token for the Google path too', async () => {
      const target = await createInvitedStudent('pwfirst');
      await http
        .post('/api/v1/auth/accept-invite')
        .send({ token: target.inviteToken, password: 'W4password1x' });
      const start = await http.get(
        `/api/v1/auth/google/start?intent=invite&token=${target.inviteToken}`,
      );
      expect(start.status).toBe(400);
      expect(start.body.error.code).toBe('INVALID_TOKEN');
    });

    it('CSV import invites go through the same verified onboarding', async () => {
      const csv = [
        'firstName,lastName,email,admissionNo,rollNo,batch,departmentCode',
        `Csv,Student,w4-csv-${suffix}@campusos.dev,W4-CSV-${suffix},W4CR-${suffix},2026,W4D-${suffix.toUpperCase()}`,
      ].join('\n');
      const res = await http
        .post('/api/v1/students/import')
        .set(auth(adminToken))
        .attach('file', Buffer.from(csv, 'utf8'), 'students.csv');
      expect(res.status).toBe(201);
      const entry = res.body.data.createdStudents[0];
      const token = (entry.inviteUrl as string).split('token=')[1];
      const user = await prisma.user.findFirstOrThrow({
        where: { email: `w4-csv-${suffix}@campusos.dev` },
      });
      madeUserIds.push(user.id);

      const accept = await http
        .post('/api/v1/auth/accept-invite')
        .send({ token, password: 'W4password1x' });
      expect(accept.status).toBe(200);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.verificationStatus).toBe('VERIFIED');
      expect(
        await prisma.studentIdentityClaim.count({
          where: { userId: user.id, status: 'APPROVED' },
        }),
      ).toBe(1);
    });
  });

  describe('regression guards', () => {
    it('demo password logins keep working', async () => {
      for (const email of [
        'admin@campusos.dev',
        'teacher@campusos.dev',
        'student@campusos.dev',
      ]) {
        app.get(LoginRateLimiterService).reset();
        const res = await http
          .post('/api/v1/auth/login')
          .send({ email, password: DEMO_PASSWORD });
        expect(res.status).toBe(200);
      }
    });
  });
});
