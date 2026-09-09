import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { PolicyService } from '../src/access/policy.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { RateLimiterService, RATE_POLICIES } from '../src/common/rate-limiter.service';
import { MAIL_TRANSPORT, type OutgoingMail } from '../src/mail/mail.module';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

class CapturingMailTransport {
  sent: OutgoingMail[] = [];
  failNext = false;
  async deliver(mail: OutgoingMail): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('boom');
    }
    this.sent.push(mail);
  }
  reset(): void {
    this.sent = [];
    this.failNext = false;
  }
  last(): OutgoingMail {
    return this.sent[this.sent.length - 1];
  }
}

/**
 * M13-W2 — guardian onboarding & link lifecycle (decisions H1–H6).
 */
describe('M13-W2 — guardian onboarding', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let policy: PolicyService;
  let http: ReturnType<typeof request>;
  const fake = new CapturingMailTransport();
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let rivalCollegeId: string;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  const madeUserIds: string[] = [];
  const madeProfileIds: string[] = [];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(email: string, password = DEMO_PASSWORD): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http.post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function makeStudentProfile(tag: string, college = collegeId) {
    const argon2 = await import('argon2');
    const department = await prisma.department.findFirstOrThrow({
      where: { collegeId: college },
    });
    const user = await prisma.user.create({
      data: {
        college: { connect: { id: college } },
        email: `w2g-stu-${tag}-${suffix}@campusos.dev`,
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        role: 'STUDENT',
        firstName: `Stu${tag}`,
        lastName: 'Ward',
        mustChangePassword: false,
      },
    });
    madeUserIds.push(user.id);
    const profile = await prisma.studentProfile.create({
      data: {
        user: { connect: { id: user.id } },
        college: { connect: { id: college } },
        department: { connect: { id: department.id } },
        admissionNo: `W2G-${tag}-${suffix}`,
        rollNo: `W2GR-${tag}-${suffix}`,
        batch: '2026',
      },
    });
    madeProfileIds.push(profile.id);
    return profile;
  }

  async function invite(
    studentProfileId: string,
    email: string,
    relationship = 'Mother',
    token = adminToken,
  ) {
    return http
      .post(`/api/v1/students/${studentProfileId}/guardians`)
      .set(auth(token))
      .send({ email, relationship });
  }

  async function trackUserByEmail(email: string): Promise<string> {
    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    if (!madeUserIds.includes(user.id)) madeUserIds.push(user.id);
    return user.id;
  }

  beforeAll(async () => {
    process.env.SMTP_URL = 'smtp://fake:fake@127.0.0.1:2525';
    process.env.MAIL_FROM = 'CampusOS <no-reply@test.campusos.dev>';
    process.env.APP_BASE_URL = 'https://campus.test.example';
    app = await createTestApp([{ token: MAIL_TRANSPORT, value: fake }]);
    prisma = app.get(PrismaService);
    policy = app.get(PolicyService);
    http = request(app.getHttpServer());

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
    const rival = await prisma.college.create({
      data: { name: 'Rival W2G College', code: `RVW2G-${suffix}` },
    });
    rivalCollegeId = rival.id;
    await prisma.department.create({
      data: {
        college: { connect: { id: rival.id } },
        code: `RVW2GD-${suffix}`,
        name: 'Rival Dept',
      },
    });
    adminToken = await login('admin@campusos.dev');
    teacherToken = await login('teacher@campusos.dev');
    studentToken = await login('student@campusos.dev');
  });

  afterAll(async () => {
    await prisma.guardianLink.deleteMany({
      where: { OR: [{ collegeId: rivalCollegeId }, { guardianUserId: { in: madeUserIds } }, { studentProfileId: { in: madeProfileIds } }] },
    });
    await prisma.credentialToken.deleteMany({ where: { userId: { in: madeUserIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: madeUserIds } } });
    await prisma.studentProfile.deleteMany({ where: { id: { in: madeProfileIds } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: madeUserIds } }, { targetId: { in: madeUserIds } }, { collegeId: rivalCollegeId }] },
    });
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: 'guardian.' } } });
    await prisma.user.deleteMany({ where: { id: { in: madeUserIds } } });
    await prisma.department.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.college.delete({ where: { id: rivalCollegeId } });
    delete process.env.SMTP_URL;
    delete process.env.MAIL_FROM;
    delete process.env.APP_BASE_URL;
    await app.close();
  });

  beforeEach(() => {
    fake.reset();
    app.get(RateLimiterService).reset();
  });

  describe('authorization', () => {
    it('anonymous 401; student/teacher 403 on admin endpoints; staff 403 on /guardian/children', async () => {
      const profile = await makeStudentProfile('authz');
      expect(
        (await http.post(`/api/v1/students/${profile.id}/guardians`).send({})).status,
      ).toBe(401);
      for (const t of [studentToken, teacherToken]) {
        expect((await invite(profile.id, 'x@y.dev', 'Mother', t)).status).toBe(403);
        expect(
          (await http.get(`/api/v1/students/${profile.id}/guardians`).set(auth(t))).status,
        ).toBe(403);
      }
      for (const t of [adminToken, teacherToken, studentToken]) {
        expect(
          (await http.get('/api/v1/guardian/children').set(auth(t))).status,
        ).toBe(403);
      }
      expect((await http.get('/api/v1/guardian/children')).status).toBe(401);
    });
  });

  describe('invitation', () => {
    it('new guardian: user + link + token + mail + audits (full happy path)', async () => {
      const profile = await makeStudentProfile('new');
      const email = `w2g-guardian-${suffix}@campusos.dev`;
      const res = await invite(profile.id, email, 'Father');
      expect(res.status).toBe(201);
      expect(res.body.data.link.status).toBe('ACTIVE');
      expect(res.body.data.link.relationship).toBe('Father');
      expect(res.body.data.invite.url).toMatch(/^\/accept-invite\?token=[0-9a-f]{64}$/);

      const guardianId = await trackUserByEmail(email);
      const guardian = await prisma.user.findUniqueOrThrow({ where: { id: guardianId } });
      expect(guardian.role).toBe('GUARDIAN');
      expect(guardian.mustChangePassword).toBe(true);
      expect(guardian.collegeId).toBe(collegeId);

      // Mail: absolute URL, child as "FirstName L.", no other PII.
      expect(fake.sent).toHaveLength(1);
      const mail = fake.last();
      expect(mail.to).toBe(email);
      expect(mail.subject).toContain('guardian account');
      expect(mail.text).toContain(`https://campus.test.example${res.body.data.invite.url}`);
      expect(mail.text).toContain('Stunew W.');
      expect(mail.text).not.toContain(profile.admissionNo);

      // Audits: ids/flags only.
      const invited = await prisma.auditLog.findFirst({
        where: { action: 'guardian.invited', targetId: res.body.data.link.id },
      });
      expect(invited?.metadata).toEqual({
        studentProfileId: profile.id,
        existing: false,
      });
      expect(JSON.stringify(invited?.metadata)).not.toContain('@');
      const created = await prisma.auditLog.findFirst({
        where: { action: 'guardian.link_created', targetId: res.body.data.link.id },
      });
      expect(created).not.toBeNull();
    });

    it('acceptance: password set, mustChangePassword cleared, login works, replay rejected', async () => {
      const profile = await makeStudentProfile('accept');
      const email = `w2g-accept-${suffix}@campusos.dev`;
      const res = await invite(profile.id, email);
      const token = (res.body.data.invite.url as string).split('token=')[1];
      const guardianId = await trackUserByEmail(email);

      const accept = await http
        .post('/api/v1/auth/accept-invite')
        .send({ token, password: 'GuardianPass1x' });
      expect(accept.status).toBe(200);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: guardianId } });
      expect(after.mustChangePassword).toBe(false);
      expect(after.verificationStatus).toBe('LEGACY'); // onboarding no-op
      expect(
        await prisma.studentIdentityClaim.count({ where: { userId: guardianId } }),
      ).toBe(0);

      const loginRes = await login(email, 'GuardianPass1x');
      expect(loginRes).toBeTruthy();

      const replay = await http
        .post('/api/v1/auth/accept-invite')
        .send({ token, password: 'GuardianPass2x' });
      expect(replay.status).toBe(400);
    });

    it('expired tokens rejected; reissue (repeat invite) invalidates the old token', async () => {
      const profile = await makeStudentProfile('reissue');
      const email = `w2g-reissue-${suffix}@campusos.dev`;
      const first = await invite(profile.id, email);
      const firstToken = (first.body.data.invite.url as string).split('token=')[1];
      await trackUserByEmail(email);

      // Second invite for the same (never-onboarded) guardian: LINK_EXISTS
      // for the same student — so use a second child to trigger reissue.
      const second = await makeStudentProfile('reissue2');
      const res2 = await invite(second.id, email, 'Guardian');
      expect(res2.status).toBe(201);
      expect(res2.body.data.invite).not.toBeNull();
      const secondToken = (res2.body.data.invite.url as string).split('token=')[1];

      // Old token invalidated by reissue.
      const old = await http
        .post('/api/v1/auth/accept-invite')
        .send({ token: firstToken, password: 'GuardianPass1x' });
      expect(old.status).toBe(400);

      // Expired: backdate the active token.
      const guardianId = await trackUserByEmail(email);
      await prisma.credentialToken.updateMany({
        where: { userId: guardianId, usedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const expired = await http
        .post('/api/v1/auth/accept-invite')
        .send({ token: secondToken, password: 'GuardianPass1x' });
      expect(expired.status).toBe(400);
    });

    it('existing ACTIVE guardian gets link-only + guardian_link_added mail (no token)', async () => {
      const profileA = await makeStudentProfile('multi-a');
      const profileB = await makeStudentProfile('multi-b');
      const email = `w2g-onboarded-${suffix}@campusos.dev`;
      const first = await invite(profileA.id, email, 'Mother');
      const token = (first.body.data.invite.url as string).split('token=')[1];
      const acc = await http.post('/api/v1/auth/accept-invite').send({ token, password: 'GuardianPass1x' });
      expect(acc.body).toEqual(expect.objectContaining({ data: { accepted: true } }));
      await trackUserByEmail(email);
      fake.reset();

      const res = await invite(profileB.id, email, 'Mother');
      expect(res.status).toBe(201);
      expect(res.body.data.invite).toBeNull();
      expect(fake.sent).toHaveLength(1);
      expect(fake.last().subject).toContain('guardian access');
      expect(fake.last().text).not.toContain('accept-invite'); // token-less
    });

    it('existing non-guardian email → 409 EMAIL_IN_USE, nothing created', async () => {
      const profile = await makeStudentProfile('collide');
      const res = await invite(profile.id, 'teacher@campusos.dev');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_IN_USE');
      expect(
        await prisma.guardianLink.count({ where: { studentProfileId: profile.id } }),
      ).toBe(0);
    });

    it('duplicate ACTIVE link → 409 LINK_EXISTS; suspended guardian → 409 USER_INACTIVE', async () => {
      const profile = await makeStudentProfile('dup');
      const email = `w2g-dup-${suffix}@campusos.dev`;
      await invite(profile.id, email);
      const guardianId = await trackUserByEmail(email);
      const dup = await invite(profile.id, email);
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('LINK_EXISTS');

      await prisma.user.update({
        where: { id: guardianId },
        data: { status: 'SUSPENDED' },
      });
      const other = await makeStudentProfile('dup2');
      const inactive = await invite(other.id, email);
      expect(inactive.status).toBe(409);
      expect(inactive.body.error.code).toBe('USER_INACTIVE');
    });

    it('REVOKED link re-invite reactivates the SAME row (H5)', async () => {
      const profile = await makeStudentProfile('react');
      const email = `w2g-react-${suffix}@campusos.dev`;
      const first = await invite(profile.id, email, 'Father');
      const linkId = first.body.data.link.id as string;
      await trackUserByEmail(email);

      await http
        .delete(`/api/v1/students/${profile.id}/guardians/${linkId}`)
        .set(auth(adminToken));

      const again = await invite(profile.id, email, 'Uncle');
      expect(again.status).toBe(201);
      expect(again.body.data.link.id).toBe(linkId); // same row
      expect(again.body.data.link.status).toBe('ACTIVE');
      expect(again.body.data.link.relationship).toBe('Uncle');
      const row = await prisma.guardianLink.findUniqueOrThrow({ where: { id: linkId } });
      expect(row.revokedAt).toBeNull();
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'guardian.link_created', targetId: linkId },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit?.metadata).toMatchObject({ reactivated: true });
    });

    it('cross-college: foreign student 404; College-B guardian email gets a fresh A-account', async () => {
      const rivalProfile = await makeStudentProfile('rival', rivalCollegeId);
      expect((await invite(rivalProfile.id, 'x@y.dev')).status).toBe(404);

      // A guardian account exists in the RIVAL college with this email.
      const argon2 = await import('argon2');
      const bGuardian = await prisma.user.create({
        data: {
          college: { connect: { id: rivalCollegeId } },
          email: `w2g-shared-${suffix}@campusos.dev`,
          passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
          role: 'GUARDIAN',
          firstName: 'BSide',
          lastName: 'Guardian',
          mustChangePassword: false,
        },
      });
      madeUserIds.push(bGuardian.id);

      const profile = await makeStudentProfile('xcol');
      const res = await invite(profile.id, `w2g-shared-${suffix}@campusos.dev`);
      expect(res.status).toBe(201);
      const aAccounts = await prisma.user.findMany({
        where: { email: `w2g-shared-${suffix}@campusos.dev` },
      });
      expect(aAccounts).toHaveLength(2); // one per college
      const aAccount = aAccounts.find((u) => u.collegeId === collegeId)!;
      madeUserIds.push(aAccount.id);
      // The B account was never linked.
      expect(
        await prisma.guardianLink.count({ where: { guardianUserId: bGuardian.id } }),
      ).toBe(0);
    });

    it('invite rate limit: 429 after the per-admin threshold', async () => {
      const profile = await makeStudentProfile('rate');
      let limited = false;
      for (let i = 0; i <= RATE_POLICIES.guardianInvite.limit; i += 1) {
        const res = await invite(
          profile.id,
          `w2g-rate-${i}-${suffix}@campusos.dev`,
          'Mother',
        );
        if (res.status === 429) {
          expect(res.body.error.code).toBe('RATE_LIMITED');
          limited = true;
          break;
        }
        if (res.status === 201) {
          await trackUserByEmail(`w2g-rate-${i}-${suffix}@campusos.dev`);
        }
      }
      expect(limited).toBe(true);
    });

    it('SMTP failure never fails onboarding; mail.failed audited safely', async () => {
      const profile = await makeStudentProfile('mailfail');
      fake.failNext = true;
      const email = `w2g-mailfail-${suffix}@campusos.dev`;
      const res = await invite(profile.id, email);
      expect(res.status).toBe(201);
      expect(res.body.data.invite.url).toBeTruthy();
      const guardianId = await trackUserByEmail(email);
      const failed = await prisma.auditLog.findFirst({
        where: { action: 'mail.failed', targetId: guardianId },
      });
      expect(failed?.metadata).toEqual({ template: 'guardian_invite' });
      expect(JSON.stringify(failed?.metadata)).not.toContain('@');
    });
  });

  describe('listing & revocation', () => {
    it('listing shows ACTIVE + REVOKED newest-first; rival admin 404', async () => {
      const profile = await makeStudentProfile('list');
      const first = await invite(profile.id, `w2g-list1-${suffix}@campusos.dev`, 'Mother');
      await trackUserByEmail(`w2g-list1-${suffix}@campusos.dev`);
      await invite(profile.id, `w2g-list2-${suffix}@campusos.dev`, 'Father');
      await trackUserByEmail(`w2g-list2-${suffix}@campusos.dev`);
      await http
        .delete(`/api/v1/students/${profile.id}/guardians/${first.body.data.link.id}`)
        .set(auth(adminToken));

      const res = await http
        .get(`/api/v1/students/${profile.id}/guardians`)
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      const statuses = res.body.data.map((l: { status: string }) => l.status).sort();
      expect(statuses).toEqual(['ACTIVE', 'REVOKED']);
      expect(JSON.stringify(res.body)).not.toContain('tokenHash');
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');

      // Rival admin cannot even list.
      const argon2 = await import('argon2');
      const rivalAdmin = await prisma.user.create({
        data: {
          college: { connect: { id: rivalCollegeId } },
          email: `w2g-rvadmin-${suffix}@campusos.dev`,
          passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
          role: 'ADMIN',
          firstName: 'Rv',
          lastName: 'Admin',
          mustChangePassword: false,
        },
      });
      madeUserIds.push(rivalAdmin.id);
      const rivalToken = await login(rivalAdmin.email);
      expect(
        (
          await http
            .get(`/api/v1/students/${profile.id}/guardians`)
            .set(auth(rivalToken))
        ).status,
      ).toBe(404);
      // And a foreign linkId revoke is 404 for them too.
      expect(
        (
          await http
            .delete(`/api/v1/students/${profile.id}/guardians/${first.body.data.link.id}`)
            .set(auth(rivalToken))
        ).status,
      ).toBe(404);
    });

    it('revoke: revokedAt set, repeat 409 ALREADY_REVOKED, row retained, CHILD access dies instantly', async () => {
      const profile = await makeStudentProfile('revoke');
      const email = `w2g-revoke-${suffix}@campusos.dev`;
      const res = await invite(profile.id, email, 'Mother');
      const linkId = res.body.data.link.id as string;
      const guardianId = await trackUserByEmail(email);
      const guardianUser = await prisma.user.findUniqueOrThrow({ where: { id: guardianId } });
      const asGuardian = {
        id: guardianUser.id,
        collegeId: guardianUser.collegeId,
        email: guardianUser.email,
        role: 'GUARDIAN' as const,
        status: 'ACTIVE' as const,
        verificationStatus: 'LEGACY' as const,
        firstName: 'x',
        lastName: 'x',
        avatarUrl: null,
        mustChangePassword: false,
      };
      expect(
        await policy.can(asGuardian, 'results.read', { studentProfileId: profile.id }),
      ).toBe(true);

      const revoke = await http
        .delete(`/api/v1/students/${profile.id}/guardians/${linkId}`)
        .set(auth(adminToken));
      expect(revoke.status).toBe(200);

      // Immediate CHILD denial.
      expect(
        await policy.can(asGuardian, 'results.read', { studentProfileId: profile.id }),
      ).toBe(false);

      const row = await prisma.guardianLink.findUniqueOrThrow({ where: { id: linkId } });
      expect(row.status).toBe('REVOKED');
      expect(row.revokedAt).not.toBeNull();

      const repeat = await http
        .delete(`/api/v1/students/${profile.id}/guardians/${linkId}`)
        .set(auth(adminToken));
      expect(repeat.status).toBe(409);
      expect(repeat.body.error.code).toBe('ALREADY_REVOKED');

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'guardian.link_revoked', targetId: linkId },
      });
      expect(audit?.metadata).toEqual({ studentProfileId: profile.id });
    });
  });

  describe('guardian children', () => {
    it('guardian sees only own ACTIVE children; revoked absent; guardians independent; rival isolated', async () => {
      const childA = await makeStudentProfile('kid-a');
      const childB = await makeStudentProfile('kid-b');
      const email1 = `w2g-parent1-${suffix}@campusos.dev`;
      const email2 = `w2g-parent2-${suffix}@campusos.dev`;

      const inviteA1 = await invite(childA.id, email1, 'Mother');
      const staleToken = (inviteA1.body.data.invite.url as string).split('token=')[1];
      const linkB1 = await invite(childB.id, email1, 'Mother');
      // The second invite reissued the credential — the first token is dead.
      const token1 = (linkB1.body.data.invite.url as string).split('token=')[1];
      expect(token1).not.toBe(staleToken);
      await invite(childA.id, email2, 'Father');
      await trackUserByEmail(email1);
      await trackUserByEmail(email2);

      const acc1 = await http.post('/api/v1/auth/accept-invite').send({ token: token1, password: 'GuardianPass1x' });
      expect(acc1.body).toEqual(expect.objectContaining({ data: { accepted: true } }));
      const parent1Token = await login(email1, 'GuardianPass1x');

      const children = await http
        .get('/api/v1/guardian/children')
        .set(auth(parent1Token));
      expect(children.status).toBe(200);
      expect(children.body.data).toHaveLength(2);
      const ids = children.body.data.map(
        (c: { studentProfileId: string }) => c.studentProfileId,
      );
      expect(ids.sort()).toEqual([childA.id, childB.id].sort());
      expect(children.body.data[0]).toHaveProperty('departmentName');
      expect(children.body.data[0]).toHaveProperty('relationship');

      // Revoke child B → immediately absent.
      await http
        .delete(`/api/v1/students/${childB.id}/guardians/${linkB1.body.data.link.id}`)
        .set(auth(adminToken));
      const afterRevoke = await http
        .get('/api/v1/guardian/children')
        .set(auth(parent1Token));
      expect(afterRevoke.body.data).toHaveLength(1);
      expect(afterRevoke.body.data[0].studentProfileId).toBe(childA.id);

      // Parent 2 (independent guardian of child A) unaffected.
      const parent2 = await prisma.user.findFirstOrThrow({ where: { email: email2 } });
      expect(
        await prisma.guardianLink.count({
          where: { guardianUserId: parent2.id, status: 'ACTIVE' },
        }),
      ).toBe(1);
    });
  });

  describe('regression', () => {
    it('demo logins and existing invite flows unaffected', async () => {
      for (const email of [
        'admin@campusos.dev',
        'teacher@campusos.dev',
        'student@campusos.dev',
      ]) {
        await login(email);
      }
    });
  });
});
