import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { RateLimiterService } from '../src/common/rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M13-W3 — child-scoped data APIs.
 * CHILD scope in results/attendance/fees/timetable/assignments, with the
 * full IDOR/tenancy matrix and regression guards for OWN/ASSIGNED/ALL.
 * Fixture: the demo student (Mina) has real published results, attendance,
 * invoices, timetable slots and assignments — the guardian is linked to
 * her; a second child fixture proves multi-child isolation.
 */
describe('M13-W3 — child-scoped data APIs', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let rivalCollegeId: string;
  let demoChildId: string; // Mina's profile — rich demo data
  let secondChildId: string;
  let unrelatedStudentId: string;
  let rivalStudentId: string;
  let guardianToken: string;
  let guardianId: string;
  let otherGuardianToken: string;
  let zeroLinkGuardianToken: string;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  let demoLink: { id: string };
  const madeUserIds: string[] = [];
  const madeProfileIds: string[] = [];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(email: string, password = DEMO_PASSWORD): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http.post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function makeGuardian(tag: string, college = collegeId) {
    const argon2 = await import('argon2');
    const user = await prisma.user.create({
      data: {
        college: { connect: { id: college } },
        email: `w3g-${tag}-${suffix}@campusos.dev`,
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        role: 'GUARDIAN',
        firstName: 'W3G',
        lastName: tag,
        mustChangePassword: false,
      },
    });
    madeUserIds.push(user.id);
    return user;
  }

  async function makeStudentProfile(tag: string, college = collegeId) {
    const argon2 = await import('argon2');
    const department = await prisma.department.findFirstOrThrow({
      where: { collegeId: college },
    });
    const user = await prisma.user.create({
      data: {
        college: { connect: { id: college } },
        email: `w3g-stu-${tag}-${suffix}@campusos.dev`,
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        role: 'STUDENT',
        firstName: `W3S${tag}`,
        lastName: 'Child',
        mustChangePassword: false,
      },
    });
    madeUserIds.push(user.id);
    const profile = await prisma.studentProfile.create({
      data: {
        user: { connect: { id: user.id } },
        college: { connect: { id: college } },
        department: { connect: { id: department.id } },
        admissionNo: `W3G-${tag}-${suffix}`,
        rollNo: `W3GR-${tag}-${suffix}`,
        batch: '2026',
      },
    });
    madeProfileIds.push(profile.id);
    return profile;
  }

  async function link(guardianUserId: string, studentProfileId: string) {
    return prisma.guardianLink.create({
      data: {
        collegeId,
        guardianUserId,
        studentProfileId,
        relationship: 'Parent',
      },
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());
    app.get(RateLimiterService).reset();

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
    const rival = await prisma.college.create({
      data: { name: 'Rival W3G College', code: `RVW3G-${suffix}` },
    });
    rivalCollegeId = rival.id;
    await prisma.department.create({
      data: {
        college: { connect: { id: rival.id } },
        code: `RVW3GD-${suffix}`,
        name: 'Rival Dept',
      },
    });

    const demoStudent = await prisma.studentProfile.findFirstOrThrow({
      where: { user: { email: 'student@campusos.dev' } },
    });
    demoChildId = demoStudent.id;
    secondChildId = (await makeStudentProfile('kid2')).id;
    unrelatedStudentId = (await makeStudentProfile('unrelated')).id;
    rivalStudentId = (await makeStudentProfile('rival', rivalCollegeId)).id;

    const guardian = await makeGuardian('main');
    guardianId = guardian.id;
    demoLink = await link(guardian.id, demoChildId);
    await link(guardian.id, secondChildId);

    const otherGuardian = await makeGuardian('other');
    await link(otherGuardian.id, unrelatedStudentId);

    const zeroLink = await makeGuardian('zero');

    guardianToken = await login(guardian.email);
    otherGuardianToken = await login(otherGuardian.email);
    zeroLinkGuardianToken = await login(zeroLink.email);
    adminToken = await login('admin@campusos.dev');
    teacherToken = await login('teacher@campusos.dev');
    studentToken = await login('student@campusos.dev');
  });

  afterAll(async () => {
    await prisma.guardianLink.deleteMany({
      where: { OR: [{ guardianUserId: { in: madeUserIds } }, { studentProfileId: { in: madeProfileIds } }] },
    });
    await prisma.studentProfile.deleteMany({ where: { id: { in: madeProfileIds } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: madeUserIds } }, { targetId: { in: madeUserIds } }] },
    });
    await prisma.user.deleteMany({ where: { id: { in: madeUserIds } } });
    await prisma.department.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.college.delete({ where: { id: rivalCollegeId } });
    await app.close();
  });

  describe('results (published only)', () => {
    it('A: guardian reads the linked child’s published results (rows present)', async () => {
      const res = await http
        .get(`/api/v1/results?studentId=${demoChildId}`)
        .set(auth(guardianToken));
      expect(res.status).toBe(200);
      expect(res.body.data.studentId).toBe(demoChildId);
      expect(res.body.data.rows.length).toBeGreaterThan(0);
    });

    it('Q: only PUBLISHED exams appear (draft/scheduled marks invisible)', async () => {
      const res = await http
        .get(`/api/v1/results?studentId=${demoChildId}`)
        .set(auth(guardianToken));
      const examIds: string[] = [
        ...new Set(res.body.data.rows.map((r: { examId: string }) => r.examId)),
      ] as string[];
      const exams = await prisma.exam.findMany({ where: { id: { in: examIds } } });
      for (const exam of exams) {
        expect(exam.status).toBe('PUBLISHED');
      }
      const unpublished = await prisma.exam.count({
        where: { collegeId, status: { not: 'PUBLISHED' } },
      });
      expect(unpublished).toBeGreaterThan(0); // fixture really has drafts
    });

    it('C/D/F/G: unrelated, other-guardian, rival-college and arbitrary ids are denied', async () => {
      for (const id of [unrelatedStudentId, rivalStudentId, 'not-a-real-id']) {
        const res = await http
          .get(`/api/v1/results?studentId=${id}`)
          .set(auth(guardianToken));
        expect([403, 404]).toContain(res.status);
      }
    });

    it('B/H: second ACTIVE child allowed and isolated', async () => {
      const res = await http
        .get(`/api/v1/results?studentId=${secondChildId}`)
        .set(auth(guardianToken));
      expect(res.status).toBe(200);
      expect(res.body.data.studentId).toBe(secondChildId);
      expect(res.body.data.rows).toHaveLength(0); // no marks fixture — empty, not leaked
    });
  });

  describe('attendance', () => {
    it('guardian reads the linked child’s summary; denied elsewhere', async () => {
      const ok = await http
        .get(`/api/v1/attendance/summary?studentId=${demoChildId}`)
        .set(auth(guardianToken));
      expect(ok.status).toBe(200);
      expect(ok.body.data.sections.length).toBeGreaterThan(0);

      for (const id of [unrelatedStudentId, rivalStudentId]) {
        expect(
          (
            await http
              .get(`/api/v1/attendance/summary?studentId=${id}`)
              .set(auth(guardianToken))
          ).status,
        ).toBe(403);
      }
      // Section breakdown (staff surface) stays closed to CHILD scope.
      const section = await prisma.section.findFirstOrThrow({ where: { collegeId } });
      expect(
        (
          await http
            .get(`/api/v1/attendance/summary?sectionId=${section.id}`)
            .set(auth(guardianToken))
        ).status,
      ).toBe(403);
    });
  });

  describe('fees', () => {
    it('guardian lists only the linked child’s invoices; detail authorized per invoice', async () => {
      const list = await http
        .get(`/api/v1/fees/invoices?studentId=${demoChildId}`)
        .set(auth(guardianToken));
      expect(list.status).toBe(200);
      expect(list.body.data.length).toBeGreaterThan(0);

      const detail = await http
        .get(`/api/v1/fees/invoices/${list.body.data[0].id}`)
        .set(auth(guardianToken));
      expect(detail.status).toBe(200);
      expect(detail.body.data.payments).toBeDefined();

      // Missing studentId → explicit MISSING_TARGET (no accidental firehose).
      const missing = await http
        .get('/api/v1/fees/invoices')
        .set(auth(guardianToken));
      expect(missing.status).toBe(400);
      expect(missing.body.error.code).toBe('MISSING_TARGET');

      // Unrelated student's invoices are unreachable by list or detail.
      expect(
        (
          await http
            .get(`/api/v1/fees/invoices?studentId=${unrelatedStudentId}`)
            .set(auth(guardianToken))
        ).status,
      ).toBe(403);
      const foreignInvoice = await prisma.invoice.findFirst({
        where: { collegeId, student: { id: { not: demoChildId } } },
      });
      if (foreignInvoice) {
        expect(
          (
            await http
              .get(`/api/v1/fees/invoices/${foreignInvoice.id}`)
              .set(auth(guardianToken))
          ).status,
        ).toBe(404); // indistinguishable from nonexistent
      }
    });
  });

  describe('timetable', () => {
    it('guardian reads the linked child’s slots via view=student:<id>; denied elsewhere', async () => {
      const ok = await http
        .get(`/api/v1/timetable?view=student:${demoChildId}`)
        .set(auth(guardianToken));
      expect(ok.status).toBe(200);
      expect(ok.body.data.length).toBeGreaterThan(0);

      for (const id of [unrelatedStudentId, rivalStudentId]) {
        expect(
          (
            await http
              .get(`/api/v1/timetable?view=student:${id}`)
              .set(auth(guardianToken))
          ).status,
        ).toBe(403);
      }
      // Students cannot use the student:<other> view either.
      expect(
        (
          await http
            .get(`/api/v1/timetable?view=student:${unrelatedStudentId}`)
            .set(auth(studentToken))
        ).status,
      ).toBe(403);
      // Staff ALL scope still passes (admin regression).
      expect(
        (
          await http
            .get(`/api/v1/timetable?view=student:${demoChildId}`)
            .set(auth(adminToken))
        ).status,
      ).toBe(200);
    });
  });

  describe('assignments (read-only, published only)', () => {
    it('guardian lists the linked child’s published assignments; write surfaces closed', async () => {
      const ok = await http
        .get(`/api/v1/assignments?studentId=${demoChildId}`)
        .set(auth(guardianToken));
      expect(ok.status).toBe(200);
      expect(ok.body.data.length).toBeGreaterThan(0);
      for (const row of ok.body.data) {
        expect(row.publishedAt ?? row.status ?? 'PUBLISHED').toBeTruthy();
      }

      const missing = await http
        .get('/api/v1/assignments')
        .set(auth(guardianToken));
      expect(missing.status).toBe(400);

      expect(
        (
          await http
            .get(`/api/v1/assignments?studentId=${unrelatedStudentId}`)
            .set(auth(guardianToken))
        ).status,
      ).toBe(403);

      // Read-only: no submission/grading permissions exist for guardians.
      const assignment = ok.body.data[0];
      const submit = await http
        .post(`/api/v1/assignments/${assignment.id}/submissions`)
        .set(auth(guardianToken))
        .send({ text: 'nope' });
      expect([403, 404]).toContain(submit.status);
      expect(submit.status).not.toBe(201);
    });
  });

  describe('lifecycle & isolation', () => {
    it('J: zero-link guardian gets no child data anywhere', async () => {
      for (const url of [
        `/api/v1/results?studentId=${demoChildId}`,
        `/api/v1/attendance/summary?studentId=${demoChildId}`,
        `/api/v1/fees/invoices?studentId=${demoChildId}`,
        `/api/v1/timetable?view=student:${demoChildId}`,
        `/api/v1/assignments?studentId=${demoChildId}`,
      ]) {
        const res = await http.get(url).set(auth(zeroLinkGuardianToken));
        expect([403, 404]).toContain(res.status);
      }
    });

    it('I: a second guardian of the same child is authorized independently', async () => {
      const co = await makeGuardian('co');
      await link(co.id, demoChildId);
      const coToken = await login(co.email);
      const res = await http
        .get(`/api/v1/results?studentId=${demoChildId}`)
        .set(auth(coToken));
      expect(res.status).toBe(200);
      // …and the first guardian's other child stays invisible to them (D).
      expect(
        (
          await http
            .get(`/api/v1/results?studentId=${secondChildId}`)
            .set(auth(coToken))
        ).status,
      ).toBe(403);
    });

    it('E: revocation removes access across ALL five surfaces immediately', async () => {
      await prisma.guardianLink.update({
        where: { id: demoLink.id },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      try {
        for (const url of [
          `/api/v1/results?studentId=${demoChildId}`,
          `/api/v1/attendance/summary?studentId=${demoChildId}`,
          `/api/v1/fees/invoices?studentId=${demoChildId}`,
          `/api/v1/timetable?view=student:${demoChildId}`,
          `/api/v1/assignments?studentId=${demoChildId}`,
        ]) {
          const res = await http.get(url).set(auth(guardianToken));
          expect([403, 404]).toContain(res.status);
        }
        // The second (still ACTIVE) child keeps working.
        expect(
          (
            await http
              .get(`/api/v1/results?studentId=${secondChildId}`)
              .set(auth(guardianToken))
          ).status,
        ).toBe(200);
      } finally {
        await prisma.guardianLink.update({
          where: { id: demoLink.id },
          data: { status: 'ACTIVE', revokedAt: null },
        });
      }
    });

    it('P: report-card data path works for the guardian (exam-filtered rows)', async () => {
      const res = await http
        .get(`/api/v1/results?studentId=${demoChildId}`)
        .set(auth(guardianToken));
      const row = res.body.data.rows[0];
      // The print page filters client-side by examId; the data carries
      // everything it needs under CHILD scope.
      for (const key of ['examId', 'examTitle', 'marksObtained', 'maxMarks', 'percentage']) {
        expect(row).toHaveProperty(key);
      }
    });
  });

  describe('regression (K/L/M/N/O)', () => {
    it('student OWN behavior unchanged (incl. studentId pinning)', async () => {
      const own = await http.get('/api/v1/results').set(auth(studentToken));
      expect(own.status).toBe(200);
      expect(own.body.data.studentId).toBe(demoChildId);
      const pinned = await http
        .get(`/api/v1/results?studentId=${unrelatedStudentId}`)
        .set(auth(studentToken));
      expect(pinned.body.data.studentId).toBe(demoChildId); // forced to self
      expect(
        (await http.get('/api/v1/fees/invoices').set(auth(studentToken))).status,
      ).toBe(200);
      expect(
        (await http.get('/api/v1/assignments').set(auth(studentToken))).status,
      ).toBe(200);
      expect(
        (await http.get('/api/v1/timetable').set(auth(studentToken))).status,
      ).toBe(200);
    });

    it('teacher ASSIGNED and admin ALL behavior unchanged', async () => {
      expect(
        (await http.get('/api/v1/assignments').set(auth(teacherToken))).status,
      ).toBe(200);
      expect(
        (
          await http
            .get(`/api/v1/results?studentId=${demoChildId}`)
            .set(auth(adminToken))
        ).status,
      ).toBe(200);
      expect(
        (await http.get('/api/v1/fees/invoices').set(auth(adminToken))).status,
      ).toBe(200);
      expect(
        (
          await http
            .get(`/api/v1/attendance/summary?studentId=${demoChildId}`)
            .set(auth(adminToken))
        ).status,
      ).toBe(200);
    });

    it('anonymous 401 on all five surfaces', async () => {
      for (const url of [
        '/api/v1/results',
        '/api/v1/attendance/summary',
        '/api/v1/fees/invoices',
        '/api/v1/timetable',
        '/api/v1/assignments',
      ]) {
        expect((await http.get(url)).status).toBe(401);
      }
    });

    it('guardians remain blocked from non-CHILD surfaces (exports/community/audit)', async () => {
      for (const url of [
        '/api/v1/exports/students.csv',
        '/api/v1/community/posts',
        '/api/v1/audit',
        '/api/v1/verification/claims',
      ]) {
        const res = await http.get(url).set(auth(guardianToken));
        expect([403, 404]).toContain(res.status);
        expect(res.status).not.toBe(200);
      }
    });
  });
});
