import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';
// Tiny valid PNG (magic bytes + minimal payload).
const PNG = Buffer.concat([
  Buffer.from('\x89PNG\r\n\x1a\n', 'binary'),
  Buffer.alloc(64, 7),
]);

/**
 * M11-W3 — student identity claims + evidence.
 * Covers submission, enumeration safety, tenant isolation, evidence signing
 * authorization, atomic decisions, notifications and audit.
 */
describe('M11-W3 — identity claims & evidence', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let departmentId: string;
  let rivalCollegeId: string;
  let rivalAdminToken: string;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string; // demo student (has own StudentProfile)
  let studentAdmissionNo: string;
  const madeUserIds: string[] = [];
  const madeProfileIds: string[] = [];

  async function login(email: string, password = DEMO_PASSWORD): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http.post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function makeStudent(tag: string, withProfile = false) {
    const argon2 = await import('argon2');
    const passwordHash = await argon2.hash(DEMO_PASSWORD, {
      type: argon2.argon2id,
    });
    const user = await prisma.user.create({
      data: {
        college: { connect: { id: collegeId } },
        email: `w3-${tag}-${suffix}@campusos.dev`,
        passwordHash,
        role: 'STUDENT',
        verificationStatus: 'UNVERIFIED',
        firstName: 'W3',
        lastName: tag,
        mustChangePassword: false,
      },
    });
    madeUserIds.push(user.id);
    let profile = null;
    if (withProfile) {
      profile = await prisma.studentProfile.create({
        data: {
          user: { connect: { id: user.id } },
          college: { connect: { id: collegeId } },
          department: { connect: { id: departmentId } },
          admissionNo: `W3-${tag}-${suffix}`,
          rollNo: `W3R-${tag}-${suffix}`,
          batch: '2026',
        },
      });
      madeProfileIds.push(profile.id);
    }
    return { user, profile, token: await login(user.email) };
  }

  async function uploadEvidence(
    token: string,
    buffer: Buffer = PNG,
    filename = 'id-card.png',
  ) {
    return http
      .post('/api/v1/verification/evidence')
      .set(auth(token))
      .attach('file', buffer, filename);
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
    const department = await prisma.department.create({
      data: {
        college: { connect: { id: collegeId } },
        code: `W3D-${suffix}`,
        name: 'W3 Claims Dept',
      },
    });
    departmentId = department.id;

    // Rival college + admin for tenancy tests.
    const argon2 = await import('argon2');
    const rival = await prisma.college.create({
      data: { name: 'Rival College W3', code: `RVW3-${suffix}` },
    });
    rivalCollegeId = rival.id;
    const rivalAdmin = await prisma.user.create({
      data: {
        college: { connect: { id: rival.id } },
        email: `rival-admin-${suffix}@campusos.dev`,
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        role: 'ADMIN',
        firstName: 'Rival',
        lastName: 'Admin',
        mustChangePassword: false,
      },
    });
    madeUserIds.push(rivalAdmin.id);

    adminToken = await login('admin@campusos.dev');
    teacherToken = await login('teacher@campusos.dev');
    studentToken = await login('student@campusos.dev');
    rivalAdminToken = await login(rivalAdmin.email);

    const demoStudent = await prisma.user.findFirstOrThrow({
      where: { email: 'student@campusos.dev' },
      include: { studentProfile: true },
    });
    studentAdmissionNo = demoStudent.studentProfile!.admissionNo;
  });

  afterAll(async () => {
    const demoStudent = await prisma.user.findFirstOrThrow({
      where: { email: 'student@campusos.dev' },
    });
    const allIds = [...madeUserIds, demoStudent.id];
    await prisma.studentIdentityClaim.deleteMany({
      where: { userId: { in: allIds } },
    });
    await prisma.evidenceFile.deleteMany({ where: { uploaderId: { in: allIds } } });
    await prisma.notification.deleteMany({
      where: { userId: { in: allIds }, type: { startsWith: 'verification.' } },
    });
    // Demo student must leave this suite as LEGACY (pre-M11 state).
    await prisma.user.update({
      where: { id: demoStudent.id },
      data: { verificationStatus: 'LEGACY' },
    });
    await prisma.studentProfile.deleteMany({ where: { id: { in: madeProfileIds } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: madeUserIds } }, { targetId: { in: madeUserIds } }] },
    });
    await prisma.user.deleteMany({ where: { id: { in: madeUserIds } } });
    await prisma.department.delete({ where: { id: departmentId } });
    await prisma.auditLog.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.department.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.college.delete({ where: { id: rivalCollegeId } });
    await app.close();
  });

  describe('evidence upload (W3.10)', () => {
    it('accepts a PNG and records purpose-restricted metadata', async () => {
      const res = await uploadEvidence(studentToken);
      expect(res.status).toBe(201);
      expect(res.body.data.evidenceFileKey).toBeTruthy();
      const row = await prisma.evidenceFile.findUniqueOrThrow({
        where: { key: res.body.data.evidenceFileKey },
      });
      expect(row.mimeType).toBe('image/png');
      expect(row.collegeId).toBe(collegeId);
    });

    it('rejects executable/script content and unsupported types', async () => {
      const exe = await uploadEvidence(
        studentToken,
        Buffer.from('#!/bin/sh\necho pwned\n'),
        'card.png',
      );
      expect(exe.status).toBe(400);
      expect(exe.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    });

    it('requires verification.submit (teacher/admin get 403)', async () => {
      expect((await uploadEvidence(teacherToken)).status).toBe(403);
      expect((await uploadEvidence(adminToken)).status).toBe(403);
    });

    it('requires authentication', async () => {
      const res = await http
        .post('/api/v1/verification/evidence')
        .attach('file', PNG, 'x.png');
      expect(res.status).toBe(401);
    });
  });

  describe('claim submission (W3.1)', () => {
    it('valid claim → PENDING, user PENDING, audited', async () => {
      const up = await uploadEvidence(studentToken);
      const res = await http
        .post('/api/v1/verification/claims')
        .set(auth(studentToken))
        .send({
          claimedAdmissionNo: studentAdmissionNo,
          evidenceFileKey: up.body.data.evidenceFileKey,
        });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('PENDING');
      expect(res.body.data.evidence.name).toBeTruthy();

      const student = await prisma.user.findFirstOrThrow({
        where: { email: 'student@campusos.dev' },
      });
      expect(student.verificationStatus).toBe('PENDING');
      const audit = await prisma.auditLog.findFirst({
        where: { actorId: student.id, action: 'verification.claim_submitted' },
      });
      expect(audit).not.toBeNull();
    });

    it('a second in-flight claim by the same user is refused', async () => {
      const up = await uploadEvidence(studentToken);
      const res = await http
        .post('/api/v1/verification/claims')
        .set(auth(studentToken))
        .send({
          claimedAdmissionNo: studentAdmissionNo,
          evidenceFileKey: up.body.data.evidenceFileKey,
        });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CLAIM_PENDING');
    });

    it('rejects evidence keys not uploaded by the claimant (arbitrary files)', async () => {
      const { token } = await makeStudent('badkey');
      // Ordinary file upload — not evidence.
      const ordinary = await http
        .post('/api/v1/files')
        .set(auth(token))
        .attach('file', PNG, 'random.png');
      const key = decodeURIComponent(
        (ordinary.body.data.url as string).replace('/api/v1/files/', ''),
      );
      const res = await http
        .post('/api/v1/verification/claims')
        .set(auth(token))
        .send({ claimedAdmissionNo: 'X-1', evidenceFileKey: key });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_EVIDENCE');

      // Someone else's evidence key is equally invalid.
      const other = await uploadEvidence(studentToken);
      const res2 = await http
        .post('/api/v1/verification/claims')
        .set(auth(token))
        .send({
          claimedAdmissionNo: 'X-1',
          evidenceFileKey: other.body.data.evidenceFileKey,
        });
      expect(res2.status).toBe(400);
    });

    it('unknown admission number → enumeration-safe PENDING claim', async () => {
      const { token } = await makeStudent('unknown');
      const up = await uploadEvidence(token);
      const res = await http
        .post('/api/v1/verification/claims')
        .set(auth(token))
        .send({
          claimedAdmissionNo: `NOPE-${suffix}`,
          evidenceFileKey: up.body.data.evidenceFileKey,
        });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('PENDING');
    });

    it('cross-college admission numbers do not resolve', async () => {
      // A real profile in the rival college.
      const argon2 = await import('argon2');
      const rivalUser = await prisma.user.create({
        data: {
          college: { connect: { id: rivalCollegeId } },
          email: `rival-stu-${suffix}@campusos.dev`,
          passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
          role: 'STUDENT',
          firstName: 'Rival',
          lastName: 'Student',
          mustChangePassword: false,
        },
      });
      madeUserIds.push(rivalUser.id);
      const rivalDept = await prisma.department.create({
        data: {
          college: { connect: { id: rivalCollegeId } },
          code: `RVD-${suffix}`,
          name: 'Rival Dept',
        },
      });
      const rivalProfile = await prisma.studentProfile.create({
        data: {
          user: { connect: { id: rivalUser.id } },
          college: { connect: { id: rivalCollegeId } },
          department: { connect: { id: rivalDept.id } },
          admissionNo: `RIVAL-ADM-${suffix}`,
          rollNo: `RV-${suffix}`,
          batch: '2026',
        },
      });
      madeProfileIds.push(rivalProfile.id);

      const { token } = await makeStudent('crosscollege');
      const up = await uploadEvidence(token);
      const res = await http
        .post('/api/v1/verification/claims')
        .set(auth(token))
        .send({
          claimedAdmissionNo: `RIVAL-ADM-${suffix}`,
          evidenceFileKey: up.body.data.evidenceFileKey,
        });
      // Same response as an unknown number — no cross-college leak.
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('PENDING');
      const claim = await prisma.studentIdentityClaim.findFirstOrThrow({
        where: { id: res.body.data.id },
      });
      expect(claim.studentProfileId).toBeNull();
    });

    it('two students racing for one profile → exactly one PENDING wins', async () => {
      const target = await makeStudent('racetarget', true);
      const rivals = await Promise.all([
        makeStudent('racer1'),
        makeStudent('racer2'),
        makeStudent('racer3'),
      ]);
      const uploads = await Promise.all(
        rivals.map((r) => uploadEvidence(r.token)),
      );
      const results = await Promise.all(
        rivals.map((r, i) =>
          http
            .post('/api/v1/verification/claims')
            .set(auth(r.token))
            .send({
              claimedAdmissionNo: target.profile!.admissionNo,
              evidenceFileKey: uploads[i].body.data.evidenceFileKey,
            }),
        ),
      );
      const wins = results.filter((r) => r.status === 201);
      const conflicts = results.filter(
        (r) => r.status === 409 && r.body.error.code === 'CLAIM_UNAVAILABLE',
      );
      expect(wins).toHaveLength(1);
      expect(conflicts).toHaveLength(2);
    });
  });

  describe('own-claim visibility (W3.2)', () => {
    it('student sees only their own claims', async () => {
      const res = await http
        .get('/api/v1/verification/claims/me')
        .set(auth(studentToken));
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      const student = await prisma.user.findFirstOrThrow({
        where: { email: 'student@campusos.dev' },
      });
      const ownClaims = await prisma.studentIdentityClaim.count({
        where: { userId: student.id },
      });
      expect(res.body.data).toHaveLength(ownClaims);
      // No foreign identifiers in the payload.
      expect(JSON.stringify(res.body)).not.toContain('decidedById');
    });

    it('teacher/admin cannot use student claim endpoints; anon gets 401', async () => {
      expect(
        (
          await http.get('/api/v1/verification/claims/me').set(auth(teacherToken))
        ).status,
      ).toBe(403);
      expect((await http.get('/api/v1/verification/claims/me')).status).toBe(401);
    });
  });

  describe('admin queue + detail (W3.3/W3.4)', () => {
    it('admin lists claims (tenant-scoped, filterable)', async () => {
      const res = await http
        .get('/api/v1/verification/claims?status=PENDING')
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
      for (const item of res.body.data) {
        expect(item.status).toBe('PENDING');
        expect(item.claimant.email).toBeTruthy();
      }
    });

    it('teacher cannot access the queue; rival admin sees an empty tenant', async () => {
      expect(
        (await http.get('/api/v1/verification/claims').set(auth(teacherToken)))
          .status,
      ).toBe(403);
      const rival = await http
        .get('/api/v1/verification/claims')
        .set(auth(rivalAdminToken));
      expect(rival.status).toBe(200);
      expect(rival.body.meta.total).toBe(0);
    });

    it('admin detail includes matched profile and an unsigned evidence reference', async () => {
      const student = await prisma.user.findFirstOrThrow({
        where: { email: 'student@campusos.dev' },
      });
      const claim = await prisma.studentIdentityClaim.findFirstOrThrow({
        where: { userId: student.id, status: 'PENDING' },
      });
      const res = await http
        .get(`/api/v1/verification/claims/${claim.id}`)
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.data.matchedProfile.belongsToClaimant).toBe(true);
      expect(res.body.data.evidence.url).toMatch(/^\/api\/v1\/files\//);
      expect(res.body.data.evidence.url).not.toContain('sig=');
      expect(res.body.data.evidence.url).not.toContain('exp=');

      // Rival-college admin gets 404 for the same claim.
      const rival = await http
        .get(`/api/v1/verification/claims/${claim.id}`)
        .set(auth(rivalAdminToken));
      expect(rival.status).toBe(404);
    });
  });

  describe('evidence signing authorization (W3.5)', () => {
    let evidenceUrl: string;

    beforeAll(async () => {
      const student = await prisma.user.findFirstOrThrow({
        where: { email: 'student@campusos.dev' },
      });
      const claim = await prisma.studentIdentityClaim.findFirstOrThrow({
        where: { userId: student.id, status: 'PENDING' },
      });
      evidenceUrl = `/api/v1/files/${encodeURIComponent(claim.evidenceFileKey!)}`;
    });

    it('the uploader can sign their own evidence and download it', async () => {
      const sign = await http
        .post('/api/v1/files/sign')
        .set(auth(studentToken))
        .send({ url: evidenceUrl });
      expect(sign.status).toBe(201);
      const dl = await http.get(sign.body.data.url);
      expect(dl.status).toBe(200);
    });

    it('an admin with verification.manage in the same college can sign', async () => {
      const sign = await http
        .post('/api/v1/files/sign')
        .set(auth(adminToken))
        .send({ url: evidenceUrl });
      expect(sign.status).toBe(201);
    });

    it('other students, teachers and rival-college admins cannot sign (404)', async () => {
      const { token } = await makeStudent('peeker');
      for (const t of [token, teacherToken, rivalAdminToken]) {
        const res = await http
          .post('/api/v1/files/sign')
          .set(auth(t))
          .send({ url: evidenceUrl });
        expect(res.status).toBe(404);
      }
    });

    it('unsigned evidence URLs are refused; anon signing is 401', async () => {
      expect((await http.get(evidenceUrl)).status).toBe(403);
      expect(
        (await http.post('/api/v1/files/sign').send({ url: evidenceUrl })).status,
      ).toBe(401);
    });

    it('evidence access is audited', async () => {
      const rows = await prisma.auditLog.findMany({
        where: { action: 'verification.evidence_accessed' },
      });
      expect(rows.length).toBeGreaterThanOrEqual(2); // owner + reviewer above
      // Metadata never contains keys, signatures or URLs.
      for (const row of rows) {
        const meta = JSON.stringify(row.metadata ?? {});
        expect(meta).not.toContain('sig=');
        expect(meta).not.toContain('/api/v1/files/');
      }
    });
  });

  describe('decisions (W3.6–W3.9)', () => {
    it('APPROVE: claim APPROVED + user VERIFIED atomically, audited, notified once', async () => {
      const student = await prisma.user.findFirstOrThrow({
        where: { email: 'student@campusos.dev' },
      });
      const claim = await prisma.studentIdentityClaim.findFirstOrThrow({
        where: { userId: student.id, status: 'PENDING' },
      });
      const res = await http
        .post(`/api/v1/verification/claims/${claim.id}/decision`)
        .set(auth(adminToken))
        .send({ decision: 'APPROVE' });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('APPROVED');

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: student.id },
      });
      expect(after.verificationStatus).toBe('VERIFIED');

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'verification.claim_approved', targetId: claim.id },
      });
      expect(audit).not.toBeNull();

      // Retried decision fails and cannot duplicate the notification.
      const retry = await http
        .post(`/api/v1/verification/claims/${claim.id}/decision`)
        .set(auth(adminToken))
        .send({ decision: 'APPROVE' });
      expect(retry.status).toBe(409);
      expect(retry.body.error.code).toBe('CLAIM_ALREADY_DECIDED');

      await new Promise((r) => setTimeout(r, 150)); // listener async
      const notifications = await prisma.notification.count({
        where: { userId: student.id, type: 'verification.approved' },
      });
      expect(notifications).toBe(1);
    });

    it('APPROVE refuses claims whose profile belongs to another account (D3)', async () => {
      const target = await makeStudent('owned', true);
      const claimant = await makeStudent('wanter');
      const up = await uploadEvidence(claimant.token);
      const submit = await http
        .post('/api/v1/verification/claims')
        .set(auth(claimant.token))
        .send({
          claimedAdmissionNo: target.profile!.admissionNo,
          evidenceFileKey: up.body.data.evidenceFileKey,
        });
      expect(submit.status).toBe(201);

      const res = await http
        .post(`/api/v1/verification/claims/${submit.body.data.id}/decision`)
        .set(auth(adminToken))
        .send({ decision: 'APPROVE' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PROFILE_HAS_ACCOUNT');

      // REJECT works, frees the slot, sets user REJECTED, notifies once.
      const reject = await http
        .post(`/api/v1/verification/claims/${submit.body.data.id}/decision`)
        .set(auth(adminToken))
        .send({ decision: 'REJECT', rejectionReason: 'Record belongs to another student' });
      expect(reject.status).toBe(201);
      expect(reject.body.data.status).toBe('REJECTED');

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: claimant.user.id },
      });
      expect(after.verificationStatus).toBe('REJECTED');

      await new Promise((r) => setTimeout(r, 150));
      const notifications = await prisma.notification.count({
        where: { userId: claimant.user.id, type: 'verification.rejected' },
      });
      expect(notifications).toBe(1);

      // Slot is free again: the profile owner can claim it now.
      const ownerUp = await uploadEvidence(target.token);
      const ownerClaim = await http
        .post('/api/v1/verification/claims')
        .set(auth(target.token))
        .send({
          claimedAdmissionNo: target.profile!.admissionNo,
          evidenceFileKey: ownerUp.body.data.evidenceFileKey,
        });
      expect(ownerClaim.status).toBe(201);
    });

    it('APPROVE of an unresolved claim is refused; REJECT requires a reason', async () => {
      const { token, user } = await makeStudent('unresolved');
      const up = await uploadEvidence(token);
      const submit = await http
        .post('/api/v1/verification/claims')
        .set(auth(token))
        .send({
          claimedAdmissionNo: `GHOST-${suffix}`,
          evidenceFileKey: up.body.data.evidenceFileKey,
        });
      const id = submit.body.data.id as string;

      const approve = await http
        .post(`/api/v1/verification/claims/${id}/decision`)
        .set(auth(adminToken))
        .send({ decision: 'APPROVE' });
      expect(approve.status).toBe(400);
      expect(approve.body.error.code).toBe('CLAIM_UNRESOLVED');

      const noReason = await http
        .post(`/api/v1/verification/claims/${id}/decision`)
        .set(auth(adminToken))
        .send({ decision: 'REJECT' });
      expect(noReason.status).toBe(400);

      const reject = await http
        .post(`/api/v1/verification/claims/${id}/decision`)
        .set(auth(adminToken))
        .send({ decision: 'REJECT', rejectionReason: 'No matching record' });
      expect(reject.status).toBe(201);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.verificationStatus).toBe('REJECTED');
    });

    it('teachers and rival admins cannot decide; students cannot decide', async () => {
      const { token } = await makeStudent('decider');
      const up = await uploadEvidence(token);
      const submit = await http
        .post('/api/v1/verification/claims')
        .set(auth(token))
        .send({
          claimedAdmissionNo: `ZZ-${suffix}`,
          evidenceFileKey: up.body.data.evidenceFileKey,
        });
      const id = submit.body.data.id as string;

      for (const [t, expected] of [
        [teacherToken, 403],
        [token, 403],
        [rivalAdminToken, 404], // cross-college: existence not leaked
      ] as const) {
        const res = await http
          .post(`/api/v1/verification/claims/${id}/decision`)
          .set(auth(t))
          .send({ decision: 'REJECT', rejectionReason: 'nope' });
        expect(res.status).toBe(expected);
      }
    });
  });
});
