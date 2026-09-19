import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M24-W2 — file authorization, session integrity and export PII.
 *
 * Implements the independent subset authorized for W2:
 *
 *  N-6  students.csv exposed student EMAIL to ACCOUNTANT. M12 declared
 *       exports admin-only; M16 later widened `users.read` to ALL scope for
 *       ACCOUNTANT, so the finance role silently gained the full directory
 *       including email. Decision O-3 = B: ACCOUNTANT keeps the export, but
 *       without email. The gate is the existing ADMIN-only `users.manage`
 *       permission resolved through PolicyService — no role-name
 *       conditional, no new permission (the same technique M19-W2 and
 *       M21-W3 already use to minimise PII by policy).
 *
 *  N-23 `verification.evidence_accessed` was written by
 *       EvidenceAuthzService BEFORE the controller ran the second gate
 *       (StoredFileAuthzService), so a request that was ultimately refused
 *       still produced a successful-access audit record.
 *
 *  N-24 Google unlink deleted the AuthIdentity but revoked no refresh
 *       token, so sessions established via the removed identity stayed
 *       valid for the full 7-day window.
 *
 * N-7, N-10, N-22 and the download-audit half of N-23 are NOT implemented
 * here — each is blocked by an explicit W2 constraint (see the completion
 * report and the design document). N-8, N-9 and Res-1 remain deferred.
 *
 * All fixtures are disposable; demo accounts are only ever authenticated
 * principals, never lifecycle targets.
 */
describe('M24-W2 — file authorization, session integrity, export PII', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  const tag = `m24w2-${suffix}`;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let collegeId: string;
  let departmentId: string;
  let passwordHash: string;

  let adminToken: string;
  let accountantToken: string;
  let teacherToken: string;
  let studentToken: string;

  // N-6 fixture: a disposable student whose email must not reach accountant
  let exportStudentEmail: string;
  let exportStudentProfileId: string;

  // N-23 fixture: evidence whose StoredFile row belongs to a rival college
  let crossEvidenceKey: string;
  let crossEvidenceId: string;
  let uploaderToken: string;
  let uploaderUserId: string;

  // N-24 fixture: a user with a Google identity and a live session
  let unlinkUserEmail: string;
  let unlinkUserId: string;

  let rivalCollegeId: string;

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  const parseCsv = (text: string) => {
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    return { header: lines[0], rows: lines.slice(1) };
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
    passwordHash = admin.passwordHash!;
    departmentId = (
      await prisma.department.findFirstOrThrow({ where: { collegeId } })
    ).id;

    const rival = await prisma.college.create({
      data: { name: 'W2 Rival', code: `RV27-${suffix}`.slice(0, 12) },
    });
    rivalCollegeId = rival.id;

    // ── N-6 fixture ──
    exportStudentEmail = `${tag}-export@campusos.dev`;
    const exportUser = await prisma.user.create({
      data: {
        collegeId,
        email: exportStudentEmail,
        passwordHash,
        role: 'STUDENT',
        status: 'ACTIVE',
        firstName: 'Export',
        lastName: 'Target',
        mustChangePassword: false,
        verificationStatus: 'VERIFIED',
      },
    });
    exportStudentProfileId = (
      await prisma.studentProfile.create({
        data: {
          collegeId,
          userId: exportUser.id,
          departmentId,
          rollNo: `R${suffix}x`.slice(0, 20),
          admissionNo: `A${suffix}x`.slice(0, 20),
          batch: '2040',
        },
      })
    ).id;

    // ── N-23 fixture ──
    // An evidence key whose EvidenceFile is ours (uploader = caller) but
    // whose StoredFile ownership row points at a rival college. The
    // evidence gate therefore PASSES while the tenancy gate REFUSES —
    // exactly the ordering the finding is about.
    unlinkUserEmail = `${tag}-uploader@campusos.dev`;
    const uploader = await prisma.user.create({
      data: {
        collegeId,
        email: unlinkUserEmail,
        passwordHash,
        role: 'STUDENT',
        status: 'ACTIVE',
        firstName: 'Up',
        lastName: 'Loader',
        mustChangePassword: false,
        verificationStatus: 'VERIFIED',
      },
    });
    uploaderUserId = uploader.id;
    unlinkUserId = uploader.id;
    crossEvidenceKey = `${suffix}crossevidence__id.png`;
    crossEvidenceId = (
      await prisma.evidenceFile.create({
        data: {
          key: crossEvidenceKey,
          collegeId,
          uploaderId: uploader.id,
          mimeType: 'image/png',
          size: 1024,
        },
      })
    ).id;
    await prisma.storedFile.create({
      data: {
        key: crossEvidenceKey,
        collegeId: rivalCollegeId, // tenancy gate must refuse this
        purpose: 'EVIDENCE',
        ownerUserId: null,
        createdById: null,
      },
    });

    // ── N-24 fixture: Google identity on the same disposable user ──
    await prisma.authIdentity.create({
      data: {
        userId: uploader.id,
        provider: 'GOOGLE',
        providerSub: `${tag}-sub`,
        emailAtLink: unlinkUserEmail,
      },
    });

    adminToken = await login('admin@campusos.dev');
    accountantToken = await login('accountant@campusos.dev');
    teacherToken = await login('teacher@campusos.dev');
    studentToken = await login('student@campusos.dev');
    uploaderToken = await login(unlinkUserEmail);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { collegeId: rivalCollegeId },
          { targetType: 'EvidenceFile', targetId: crossEvidenceId },
          { actorId: { in: [uploaderUserId] } },
        ],
      },
    });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: [uploaderUserId] } } });
    await prisma.authIdentity.deleteMany({ where: { userId: { in: [uploaderUserId] } } });
    await prisma.storedFile.deleteMany({ where: { key: crossEvidenceKey } });
    await prisma.evidenceFile.deleteMany({ where: { key: crossEvidenceKey } });
    await prisma.studentProfile.deleteMany({
      where: { user: { email: { startsWith: tag } } },
    });
    await prisma.user.deleteMany({ where: { email: { startsWith: tag } } });
    await prisma.college.deleteMany({ where: { id: rivalCollegeId } });
    await app.close();
  });

  // ════════════════ N-6 · O-3(B) ════════════════

  describe('N-6 — students.csv PII boundary (O-3 = B)', () => {
    const ADMIN_HEADER =
      'firstName,lastName,email,admissionNo,rollNo,department,batch,status';
    const REDUCED_HEADER =
      'firstName,lastName,admissionNo,rollNo,department,batch,status';

    it('ADMIN retains the full export including email', async () => {
      const res = await http
        .get('/api/v1/exports/students.csv')
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      const { header, rows } = parseCsv(res.text);
      expect(header).toBe(ADMIN_HEADER);
      expect(rows.some((r) => r.includes(exportStudentEmail))).toBe(true);
    });

    it('ACCOUNTANT retains access but receives NO email column or data', async () => {
      const res = await http
        .get('/api/v1/exports/students.csv')
        .set(auth(accountantToken));
      // access preserved (O-3 = B: do not narrow the permission)
      expect(res.status).toBe(200);
      const { header, rows } = parseCsv(res.text);
      // the email COLUMN is gone
      expect(header).toBe(REDUCED_HEADER);
      expect(header).not.toContain('email');
      // and no email VALUE leaks in any row
      expect(res.text).not.toContain(exportStudentEmail);
      expect(res.text).not.toContain('@campusos.dev');
      // the row is still present — only the PII field was dropped
      expect(rows.some((r) => r.includes(`R${suffix}x`.slice(0, 20)))).toBe(true);
    });

    it('no other PII field was added to compensate for the removal', async () => {
      const res = await http
        .get('/api/v1/exports/students.csv')
        .set(auth(accountantToken));
      const { header } = parseCsv(res.text);
      // exactly the admin columns minus email — nothing new
      expect(header.split(',').sort()).toEqual(
        ADMIN_HEADER.split(',')
          .filter((c) => c !== 'email')
          .sort(),
      );
      for (const leaked of ['guardian', 'phone', 'address', 'dateOfBirth', 'dob']) {
        expect(header.toLowerCase()).not.toContain(leaked.toLowerCase());
      }
    });

    it('both principals see a deterministic header across repeated calls', async () => {
      for (let i = 0; i < 2; i += 1) {
        const a = await http.get('/api/v1/exports/students.csv').set(auth(adminToken));
        const b = await http
          .get('/api/v1/exports/students.csv')
          .set(auth(accountantToken));
        expect(parseCsv(a.text).header).toBe(ADMIN_HEADER);
        expect(parseCsv(b.text).header).toBe(REDUCED_HEADER);
      }
    });

    it('unauthorized roles and anonymous remain denied exactly as before', async () => {
      for (const token of [teacherToken, studentToken]) {
        const res = await http
          .get('/api/v1/exports/students.csv')
          .set(auth(token));
        expect(res.status).toBe(403);
        expect(res.text).not.toContain(exportStudentEmail);
      }
      const anon = await http.get('/api/v1/exports/students.csv');
      expect(anon.status).toBe(401);
    });

    it('a client-supplied collegeId cannot widen the export or restore email', async () => {
      const res = await http
        .get(
          `/api/v1/exports/students.csv?collegeId=${rivalCollegeId}&scope=ALL&role=ADMIN`,
        )
        .set(auth(accountantToken));
      expect(res.status).toBe(200);
      expect(parseCsv(res.text).header).toBe(REDUCED_HEADER);
      expect(res.text).not.toContain('@campusos.dev');
    });

    it('the export stays tenant-scoped for both principals', async () => {
      // A rival-college student must never appear.
      const rivalDept = await prisma.department.create({
        data: { collegeId: rivalCollegeId, code: `RD${suffix}`.slice(0, 10), name: 'RD' },
      });
      const rivalUser = await prisma.user.create({
        data: {
          collegeId: rivalCollegeId,
          email: `${tag}-rival@rival.dev`,
          passwordHash,
          role: 'STUDENT',
          status: 'ACTIVE',
          firstName: 'RivalOnly',
          lastName: 'Student',
          mustChangePassword: false,
          verificationStatus: 'VERIFIED',
        },
      });
      await prisma.studentProfile.create({
        data: {
          collegeId: rivalCollegeId,
          userId: rivalUser.id,
          departmentId: rivalDept.id,
          rollNo: `RV${suffix}`.slice(0, 20),
          admissionNo: `RA${suffix}`.slice(0, 20),
          batch: '2040',
        },
      });
      try {
        for (const token of [adminToken, accountantToken]) {
          const res = await http
            .get('/api/v1/exports/students.csv')
            .set(auth(token));
          expect(res.status).toBe(200);
          expect(res.text).not.toContain('RivalOnly');
          expect(res.text).not.toContain(`RV${suffix}`.slice(0, 20));
        }
      } finally {
        await prisma.studentProfile.deleteMany({ where: { userId: rivalUser.id } });
        await prisma.user.deleteMany({ where: { id: rivalUser.id } });
        await prisma.department.deleteMany({ where: { id: rivalDept.id } });
      }
    });

    it('the export audit event is unchanged and carries no PII', async () => {
      const before = await prisma.auditLog.count({
        where: { action: 'exports.generated' },
      });
      const res = await http
        .get('/api/v1/exports/students.csv')
        .set(auth(accountantToken));
      expect(res.status).toBe(200);
      const rows = await prisma.auditLog.findMany({
        where: { action: 'exports.generated' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      expect(await prisma.auditLog.count({ where: { action: 'exports.generated' } })).toBe(
        before + 1,
      );
      const meta = JSON.stringify(rows[0].metadata);
      expect(meta).not.toContain('@campusos.dev');
      expect(Object.keys(rows[0].metadata as object).sort()).toEqual(['export', 'rows']);
    });
  });

  // ════════════════ N-23 · audit ordering ════════════════

  describe('N-23 — evidence access audit must follow ALL authorization gates', () => {
    const signUrl = (token: string, key: string) =>
      http
        .post('/api/v1/files/sign')
        .set(auth(token))
        .send({ url: `/api/v1/files/${key}` });

    it('a refused evidence signing writes NO successful-access audit record', async () => {
      const before = await prisma.auditLog.count({
        where: { action: 'verification.evidence_accessed', targetId: crossEvidenceId },
      });
      const totalBefore = await prisma.auditLog.count();

      // Uploader passes the evidence gate, but the StoredFile tenancy gate
      // refuses because the ownership row belongs to a rival college.
      const res = await signUrl(uploaderToken, crossEvidenceKey);
      expect(res.status).toBe(404);
      expect(res.body.data).toBeUndefined();

      // Before the fix the evidence gate had already logged a successful
      // access at this point — a false positive in the security trail.
      expect(
        await prisma.auditLog.count({
          where: { action: 'verification.evidence_accessed', targetId: crossEvidenceId },
        }),
      ).toBe(before);
      expect(await prisma.auditLog.count()).toBe(totalBefore);
    });

    it('an unauthorized principal is refused and writes nothing', async () => {
      const totalBefore = await prisma.auditLog.count();
      for (const token of [studentToken, teacherToken]) {
        const res = await signUrl(token, crossEvidenceKey);
        expect(res.status).toBe(404);
      }
      expect(await prisma.auditLog.count()).toBe(totalBefore);
    });

    it('a genuinely authorized evidence signing still audits exactly once, server-derived', async () => {
      // Consistent evidence: EvidenceFile and StoredFile both in our college.
      const key = `${suffix}okevidence__id.png`;
      const evidence = await prisma.evidenceFile.create({
        data: {
          key,
          collegeId,
          uploaderId: uploaderUserId,
          mimeType: 'image/png',
          size: 512,
        },
      });
      await prisma.storedFile.create({
        data: {
          key,
          collegeId,
          purpose: 'EVIDENCE',
          ownerUserId: uploaderUserId,
          createdById: uploaderUserId,
        },
      });
      try {
        const before = await prisma.auditLog.count({
          where: { action: 'verification.evidence_accessed', targetId: evidence.id },
        });
        const res = await signUrl(uploaderToken, key);
        expect([200, 201]).toContain(res.status);
        expect(res.body.data.url).toContain('exp=');
        expect(res.body.data.url).toContain('sig=');

        const rows = await prisma.auditLog.findMany({
          where: { action: 'verification.evidence_accessed', targetId: evidence.id },
          orderBy: { createdAt: 'desc' },
        });
        expect(rows.length - before).toBe(1);
        expect(rows[0].actorId).toBe(uploaderUserId); // server-derived
        expect(rows[0].collegeId).toBe(collegeId); // server-derived
        expect(rows[0].targetType).toBe('EvidenceFile');
        // metadata stays a bounded shape — never key, URL or signature
        expect(Object.keys(rows[0].metadata as object)).toEqual(['as']);
        const meta = JSON.stringify(rows[0].metadata);
        expect(meta).not.toContain(key);
        expect(meta).not.toContain('sig');
      } finally {
        await prisma.auditLog.deleteMany({ where: { targetId: evidence.id } });
        await prisma.storedFile.deleteMany({ where: { key } });
        await prisma.evidenceFile.deleteMany({ where: { key } });
      }
    });
  });

  // ════════════════ N-24 · session integrity ════════════════

  describe('N-24 — Google unlink must revoke sessions', () => {
    it('unlinking Google revokes the account\u2019s refresh sessions', async () => {
      // Establish a real session for the fixture user.
      app.get(LoginRateLimiterService).reset();
      const loginRes = await http
        .post('/api/v1/auth/login')
        .send({ email: unlinkUserEmail, password: DEMO_PASSWORD });
      expect(loginRes.status).toBe(200);
      const cookies = loginRes.headers['set-cookie'] as unknown as string[];
      expect(cookies).toBeDefined();

      const liveBefore = await prisma.refreshToken.count({
        where: { userId: unlinkUserId, revokedAt: null },
      });
      expect(liveBefore).toBeGreaterThan(0);

      const unlink = await http
        .delete('/api/v1/auth/google/link')
        .set(auth(await login(unlinkUserEmail)));
      expect(unlink.status).toBe(200);
      expect(unlink.body.data.unlinked).toBe(true);

      // Before the fix every refresh family stayed live for 7 days.
      expect(
        await prisma.refreshToken.count({
          where: { userId: unlinkUserId, revokedAt: null },
        }),
      ).toBe(0);

      // The identity really is gone, and the refresh cookie no longer works.
      expect(
        await prisma.authIdentity.count({
          where: { userId: unlinkUserId, provider: 'GOOGLE' },
        }),
      ).toBe(0);
      const refresh = await http
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookies.join('; '));
      expect(refresh.status).toBe(401);
    });

    it('unlink remains self-service and authorization is unchanged', async () => {
      const anon = await http.delete('/api/v1/auth/google/link');
      expect(anon.status).toBe(401);
      // a second unlink is NOT_LINKED, not a crash
      const again = await http
        .delete('/api/v1/auth/google/link')
        .set(auth(await login(unlinkUserEmail)));
      expect(again.status).toBeGreaterThanOrEqual(400);
      expect(again.status).not.toBe(500);
    });
  });

  // ════════════════ invariants ════════════════

  describe('invariants', () => {
    it('no role-name conditional was introduced in the touched sources', async () => {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      for (const file of [
        'exports/exports.module.ts',
        'files/files.controller.ts',
        'files/evidence-authz.service.ts',
        'files/stored-file-authz.service.ts',
        'auth/google/google-auth.service.ts',
      ]) {
        const src = readFileSync(join(__dirname, '..', 'src', file), 'utf8');
        expect(src).not.toContain('user.role ===');
        for (const role of ['ADMIN', 'ACCOUNTANT', 'TEACHER', 'GUARDIAN']) {
          expect(src).not.toContain(`role === '${role}'`);
        }
      }
    });

    it('O-4(B2): OTHER-purpose files keep their existing same-college behaviour', async () => {
      // Explicitly pinned: W2 must NOT fail closed on OTHER files.
      const key = `${suffix}otherfile__notes.txt`;
      const owner = await prisma.user.findFirstOrThrow({
        where: { email: 'student@campusos.dev' },
      });
      await prisma.storedFile.create({
        data: {
          key,
          collegeId,
          purpose: 'OTHER',
          ownerUserId: owner.id,
          createdById: owner.id,
        },
      });
      try {
        // a DIFFERENT same-college user can still sign it (unchanged)
        const res = await http
          .post('/api/v1/files/sign')
          .set(auth(adminToken))
          .send({ url: `/api/v1/files/${key}` });
        expect([200, 201]).toContain(res.status);
      } finally {
        await prisma.storedFile.deleteMany({ where: { key } });
      }
    });

    it('signed-URL verification and traversal protection remain intact', async () => {
      const unsigned = await http.get(`/api/v1/files/${crossEvidenceKey}`);
      expect(unsigned.status).toBe(403);
      const forged = await http.get(
        `/api/v1/files/${crossEvidenceKey}?exp=9999999999&sig=deadbeef`,
      );
      expect(forged.status).toBe(403);
      for (const bad of ['%2e%2e%2fetc%2fpasswd', '..', 'a/b']) {
        const res = await http
          .post('/api/v1/files/sign')
          .set(auth(adminToken))
          .send({ url: `/api/v1/files/${bad}` });
        expect(res.status).toBe(400);
        expect(res.status).not.toBe(500);
      }
    });

    it('M23 S-1 remains closed', async () => {
      const unassigned = await prisma.studentProfile.findFirstOrThrow({
        where: {
          collegeId,
          enrollments: {
            none: {
              status: 'ACTIVE',
              section: {
                teachingAssignments: {
                  some: { teacher: { user: { email: 'teacher@campusos.dev' } } },
                },
              },
            },
          },
        },
      });
      const res = await http
        .get(`/api/v1/results/transcript?studentId=${unassigned.id}`)
        .set(auth(teacherToken));
      expect(res.status).toBe(404);
      expect(res.body.data).toBeUndefined();
    });
  });
});
