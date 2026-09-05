import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';
const ADMIN = 'admin@campusos.dev';
const TEACHER = 'teacher@campusos.dev';
const NEW_PASSWORD = 'Sup3rSecret!pw';

describe('M10-W2 — invitation & password-reset tokens', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let adminToken: string;
  let departmentId: string;
  const suffix = Date.now().toString(36);
  const studentEmail = `invitee-${suffix}@campusos.dev`;
  let inviteToken: string;
  let studentUserId: string;
  let studentProfileId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    app.get(LoginRateLimiterService).reset();
    http = request(app.getHttpServer());

    const login = await http
      .post('/api/v1/auth/login')
      .send({ email: ADMIN, password: DEMO_PASSWORD });
    adminToken = login.body.data.accessToken;

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: ADMIN },
    });
    const department = await prisma.department.create({
      data: {
        college: { connect: { id: admin.collegeId } },
        code: `W2-${suffix}`,
        name: 'W2 Dept',
      },
    });
    departmentId = department.id;
  });

  afterAll(async () => {
    if (studentProfileId) {
      await prisma.enrollment.deleteMany({
        where: { studentId: studentProfileId },
      });
      // M11-W4: invite acceptance creates a synthetic APPROVED claim.
      await prisma.studentIdentityClaim.deleteMany({
        where: { studentProfileId },
      });
      await prisma.studentProfile.delete({ where: { id: studentProfileId } });
    }
    if (studentUserId) {
      await prisma.notification.deleteMany({ where: { userId: studentUserId } });
      await prisma.auditLog.deleteMany({
        where: { OR: [{ actorId: studentUserId }, { targetId: studentUserId }] },
      });
      await prisma.user.delete({ where: { id: studentUserId } });
    }
    await prisma.department.delete({ where: { id: departmentId } });
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  it('creating a student returns an invite link, never a password', async () => {
    const res = await http
      .post('/api/v1/students')
      .set(auth())
      .send({
        firstName: 'Invi',
        lastName: 'Tee',
        email: studentEmail,
        departmentId,
        admissionNo: `ADM-W2-${suffix}`,
        rollNo: `W2-${suffix}`,
        batch: '2026',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.tempPassword).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/tempPassword/);
    expect(res.body.data.invite.url).toMatch(
      /^\/accept-invite\?token=[0-9a-f]{64}$/,
    );
    inviteToken = res.body.data.invite.url.split('token=')[1];
    studentProfileId = res.body.data.student.id;

    const user = await prisma.user.findFirstOrThrow({
      where: { email: studentEmail },
    });
    studentUserId = user.id;
  });

  it('stores only a hash of the token, never the raw value', async () => {
    const rows = await prisma.credentialToken.findMany({
      where: { userId: studentUserId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].purpose).toBe('INVITE');
    expect(rows[0].tokenHash).not.toBe(inviteToken);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // ~48h expiry
    const ttl = rows[0].expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(47 * 60 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(48 * 60 * 60 * 1000);
  });

  it('cannot log in before accepting the invite', async () => {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email: studentEmail, password: NEW_PASSWORD });
    expect(res.status).toBe(401);
  });

  it('rejects weak passwords and malformed tokens with generic errors', async () => {
    const weak = await http
      .post('/api/v1/auth/accept-invite')
      .send({ token: inviteToken, password: 'short' });
    expect(weak.status).toBe(400);

    const bogus = await http
      .post('/api/v1/auth/accept-invite')
      .send({ token: 'f'.repeat(64), password: NEW_PASSWORD });
    expect(bogus.status).toBe(400);
    expect(bogus.body.error.code).toBe('INVALID_TOKEN');
    expect(bogus.body.error.message).not.toMatch(/user|email|exist/i);
  });

  it('an invite token cannot be used on the reset endpoint', async () => {
    const res = await http
      .post('/api/v1/auth/reset-password')
      .send({ token: inviteToken, password: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('accepts the invite, sets the password and clears mustChangePassword', async () => {
    const res = await http
      .post('/api/v1/auth/accept-invite')
      .send({ token: inviteToken, password: NEW_PASSWORD });
    expect(res.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: studentUserId },
    });
    expect(user.mustChangePassword).toBe(false);

    app.get(LoginRateLimiterService).reset();
    const login = await http
      .post('/api/v1/auth/login')
      .send({ email: studentEmail, password: NEW_PASSWORD });
    expect(login.status).toBe(200);
  });

  it('a used invite token is rejected (one-time)', async () => {
    const res = await http
      .post('/api/v1/auth/accept-invite')
      .send({ token: inviteToken, password: 'Another1Pass!x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  describe('admin reset links', () => {
    let firstReset: string;
    let secondReset: string;

    it('requires users.manage', async () => {
      app.get(LoginRateLimiterService).reset();
      const teacherLogin = await http
        .post('/api/v1/auth/login')
        .send({ email: TEACHER, password: DEMO_PASSWORD });
      const res = await http
        .post(`/api/v1/users/${studentUserId}/reset-link`)
        .set({ Authorization: `Bearer ${teacherLogin.body.data.accessToken}` });
      expect(res.status).toBe(403);
    });

    it('returns 404 for a user outside the admin college', async () => {
      const res = await http
        .post('/api/v1/users/clzzzzzzzzzzzzzzzzzzzzzzz/reset-link')
        .set(auth());
      expect(res.status).toBe(404);
    });

    it('issues a reset link and revokes the previous one', async () => {
      const first = await http
        .post(`/api/v1/users/${studentUserId}/reset-link`)
        .set(auth());
      expect(first.status).toBe(201);
      expect(first.body.data.url).toMatch(
        /^\/accept-invite\?token=[0-9a-f]{64}&purpose=reset$/,
      );
      firstReset = first.body.data.url.match(/token=([0-9a-f]{64})/)[1];

      const second = await http
        .post(`/api/v1/users/${studentUserId}/reset-link`)
        .set(auth());
      expect(second.status).toBe(201);
      secondReset = second.body.data.url.match(/token=([0-9a-f]{64})/)[1];

      // The older link no longer works.
      const stale = await http
        .post('/api/v1/auth/reset-password')
        .send({ token: firstReset, password: 'Freshly1Reset!x' });
      expect(stale.status).toBe(400);
    });

    it('accepts the active reset link exactly once', async () => {
      const ok = await http
        .post('/api/v1/auth/reset-password')
        .send({ token: secondReset, password: 'Freshly1Reset!x' });
      expect(ok.status).toBe(200);

      const again = await http
        .post('/api/v1/auth/reset-password')
        .send({ token: secondReset, password: 'Freshly1Reset!y' });
      expect(again.status).toBe(400);

      app.get(LoginRateLimiterService).reset();
      const login = await http
        .post('/api/v1/auth/login')
        .send({ email: studentEmail, password: 'Freshly1Reset!x' });
      expect(login.status).toBe(200);
    });

    it('audited issuance and acceptance', async () => {
      const actions = await prisma.auditLog.findMany({
        where: { targetId: studentUserId },
        select: { action: true },
      });
      const names = actions.map((a) => a.action);
      expect(names).toEqual(
        expect.arrayContaining([
          'auth.invite_issued',
          'auth.invite_accepted',
          'auth.reset_issued',
          'auth.reset_accepted',
        ]),
      );
    });
  });
});
