import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M24-W1 — input validation & tenancy hardening.
 *
 *  N-1  HIGH  GET /results/analytics accepted an unvalidated `examId`.
 *             Omitting it produced `where: { examId: undefined }`, which
 *             Prisma drops, and `ExamPaper` carries no `collegeId` — so the
 *             query returned EVERY paper in EVERY college. Array-valued
 *             input reached Prisma and produced a 500.
 *  N-5        `isoDate` was a syntactic regex only, so `2024-13-45` reached
 *             Prisma as `Invalid Date` (500), and in attendance session
 *             generation every `NaN` comparison evaluated false, BYPASSING
 *             the OUTSIDE_TERM guard.
 *  N-13       `analytics` applied `assertTermOpen` to a pure read, so exam
 *             analytics became permanently unreachable once a term closed.
 *  N-25       `decodeURIComponent` on a validated-but-insufficient key threw
 *             an unhandled `URIError` (500 instead of 400).
 *  Array class (concrete N-1 variants): array/duplicate `studentId` on the
 *             finalized-results reads, and array `token` on the PUBLIC
 *             `/auth/invite-info`, all reached Prisma and produced 500s.
 *
 * All fixtures are disposable and removed FK-safely. Demo accounts are used
 * only as authenticated principals, never as lifecycle targets.
 */
describe('M24-W1 — input validation & tenancy hardening', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  const tag = `m24w1-${suffix}`;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let collegeId: string;
  let departmentId: string;
  let adminUserId: string;
  let passwordHash: string;

  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  let accountantToken: string;

  // own-tenant fixtures
  let yearId: string;
  let openTermId: string;
  let closedTermId: string;
  let courseId: string;
  let openSectionId: string;
  let closedSectionId: string;
  let ownExamId: string;
  let ownPaperId: string;
  let closedExamId: string;
  let studentProfileId: string;

  // rival tenant
  let rivalCollegeId: string;
  let rivalExamId: string;
  let rivalPaperId: string;
  const RIVAL_COURSE_CODE = `RVX-${suffix}`.slice(0, 12);

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
    adminUserId = admin.id;
    passwordHash = admin.passwordHash!;
    departmentId = (
      await prisma.department.findFirstOrThrow({ where: { collegeId } })
    ).id;

    yearId = (
      await prisma.academicYear.create({
        data: {
          collegeId,
          label: `${tag}-AY`,
          startsOn: new Date('2038-08-01'),
          endsOn: new Date('2039-06-30'),
        },
      })
    ).id;
    const mkTerm = async (label: string, from: string, to: string, status: 'ACTIVE' | 'CLOSED') =>
      (
        await prisma.term.create({
          data: {
            collegeId,
            academicYearId: yearId,
            label,
            startsOn: new Date(from),
            endsOn: new Date(to),
            status,
          },
        })
      ).id;
    openTermId = await mkTerm(`${tag}-TO`, '2038-08-01', '2038-12-20', 'ACTIVE');
    closedTermId = await mkTerm(`${tag}-TC`, '2039-01-05', '2039-05-30', 'CLOSED');

    courseId = (
      await prisma.course.create({
        data: {
          collegeId,
          departmentId,
          code: `${suffix}W1`.slice(0, 12),
          title: `${tag} Course`,
          credits: 3,
        },
      })
    ).id;
    openSectionId = (
      await prisma.section.create({
        data: { collegeId, courseId, termId: openTermId, name: 'W1O', capacity: 30 },
      })
    ).id;
    closedSectionId = (
      await prisma.section.create({
        data: { collegeId, courseId, termId: closedTermId, name: 'W1C', capacity: 30 },
      })
    ).id;

    // A disposable student with a mark, so analytics has real content.
    const studentUser = await prisma.user.create({
      data: {
        collegeId,
        email: `${tag}-stu@campusos.dev`,
        passwordHash,
        role: 'STUDENT',
        status: 'ACTIVE',
        firstName: 'W1',
        lastName: 'Student',
        mustChangePassword: false,
        verificationStatus: 'VERIFIED',
      },
    });
    studentProfileId = (
      await prisma.studentProfile.create({
        data: {
          collegeId,
          userId: studentUser.id,
          departmentId,
          rollNo: `R${suffix}w1`.slice(0, 20),
          admissionNo: `A${suffix}w1`.slice(0, 20),
          batch: '2038',
        },
      })
    ).id;
    await prisma.enrollment.create({
      data: { sectionId: openSectionId, studentId: studentProfileId, status: 'ACTIVE' },
    });

    async function mkExam(termId: string, sectionId: string, title: string, mark: number) {
      const exam = await prisma.exam.create({
        data: { collegeId, termId, title, type: 'MIDTERM', status: 'PUBLISHED', publishedAt: new Date() },
      });
      const paper = await prisma.examPaper.create({
        data: { examId: exam.id, sectionId, maxMarks: 100, examDate: new Date('2038-11-01'), room: 'R1' },
      });
      await prisma.mark.create({
        data: {
          examPaperId: paper.id,
          studentId: studentProfileId,
          marksObtained: mark,
          enteredById: adminUserId,
          lockedAt: new Date(),
        },
      });
      return { examId: exam.id, paperId: paper.id };
    }
    const own = await mkExam(openTermId, openSectionId, `${tag}-own-exam`, 91);
    ownExamId = own.examId;
    ownPaperId = own.paperId;
    const closed = await mkExam(closedTermId, closedSectionId, `${tag}-closed-exam`, 77);
    closedExamId = closed.examId;

    // ── Rival tenant: its own exam, paper and mark ──
    const rival = await prisma.college.create({
      data: { name: 'W1 Rival College', code: `RV26-${suffix}`.slice(0, 12) },
    });
    rivalCollegeId = rival.id;
    const rivalDept = await prisma.department.create({
      data: { collegeId: rival.id, code: `R26-${suffix}`.slice(0, 10), name: 'RivalDept' },
    });
    const rivalYear = await prisma.academicYear.create({
      data: {
        collegeId: rival.id,
        label: `${tag}-RAY`,
        startsOn: new Date('2038-08-01'),
        endsOn: new Date('2039-06-30'),
      },
    });
    const rivalTerm = await prisma.term.create({
      data: {
        collegeId: rival.id,
        academicYearId: rivalYear.id,
        label: `${tag}-RT`,
        startsOn: new Date('2038-08-01'),
        endsOn: new Date('2038-12-20'),
        status: 'ACTIVE',
      },
    });
    const rivalCourse = await prisma.course.create({
      data: {
        collegeId: rival.id,
        departmentId: rivalDept.id,
        code: RIVAL_COURSE_CODE,
        title: 'Rival Secret Course',
        credits: 3,
      },
    });
    const rivalSection = await prisma.section.create({
      data: { collegeId: rival.id, courseId: rivalCourse.id, termId: rivalTerm.id, name: 'RVSEC', capacity: 10 },
    });
    const rivalStudentUser = await prisma.user.create({
      data: {
        collegeId: rival.id,
        email: `${tag}-rstu@rival.dev`,
        passwordHash,
        role: 'STUDENT',
        status: 'ACTIVE',
        firstName: 'Rival',
        lastName: 'Student',
        mustChangePassword: false,
        verificationStatus: 'VERIFIED',
      },
    });
    const rivalProfile = await prisma.studentProfile.create({
      data: {
        collegeId: rival.id,
        userId: rivalStudentUser.id,
        departmentId: rivalDept.id,
        rollNo: `RR${suffix}`.slice(0, 20),
        admissionNo: `RA${suffix}`.slice(0, 20),
        batch: '2038',
      },
    });
    const rivalExam = await prisma.exam.create({
      data: {
        collegeId: rival.id,
        termId: rivalTerm.id,
        title: 'Rival Secret Exam',
        type: 'FINAL',
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    rivalExamId = rivalExam.id;
    const rivalPaper = await prisma.examPaper.create({
      data: {
        examId: rivalExam.id,
        sectionId: rivalSection.id,
        maxMarks: 200,
        examDate: new Date('2038-11-02'),
        room: 'RIVALROOM',
      },
    });
    rivalPaperId = rivalPaper.id;
    await prisma.mark.create({
      data: {
        examPaperId: rivalPaper.id,
        studentId: rivalProfile.id,
        marksObtained: 123,
        enteredById: rivalStudentUser.id,
        lockedAt: new Date(),
      },
    });

    adminToken = await login('admin@campusos.dev');
    teacherToken = await login('teacher@campusos.dev');
    studentToken = await login('student@campusos.dev');
    accountantToken = await login('accountant@campusos.dev');
  });

  afterAll(async () => {
    await prisma.mark.deleteMany({
      where: { examPaper: { exam: { OR: [{ termId: { in: [openTermId, closedTermId] } }, { collegeId: rivalCollegeId }] } } },
    });
    await prisma.examPaper.deleteMany({
      where: { exam: { OR: [{ termId: { in: [openTermId, closedTermId] } }, { collegeId: rivalCollegeId }] } },
    });
    await prisma.exam.deleteMany({
      where: { OR: [{ termId: { in: [openTermId, closedTermId] } }, { collegeId: rivalCollegeId }] },
    });
    await prisma.attendanceRecord.deleteMany({
      where: { session: { section: { termId: { in: [openTermId, closedTermId] } } } },
    });
    await prisma.classSession.deleteMany({
      where: { section: { termId: { in: [openTermId, closedTermId] } } },
    });
    await prisma.timetableSlot.deleteMany({
      where: { section: { termId: { in: [openTermId, closedTermId] } } },
    });
    await prisma.enrollment.deleteMany({
      where: { section: { OR: [{ termId: { in: [openTermId, closedTermId] } }, { collegeId: rivalCollegeId }] } },
    });
    await prisma.section.deleteMany({
      where: { OR: [{ termId: { in: [openTermId, closedTermId] } }, { collegeId: rivalCollegeId }] },
    });
    await prisma.term.deleteMany({
      where: { OR: [{ academicYearId: yearId }, { collegeId: rivalCollegeId }] },
    });
    await prisma.academicYear.deleteMany({
      where: { OR: [{ id: yearId }, { collegeId: rivalCollegeId }] },
    });
    await prisma.studentProfile.deleteMany({ where: { user: { email: { startsWith: tag } } } });
    await prisma.course.deleteMany({
      where: { OR: [{ id: courseId }, { collegeId: rivalCollegeId }] },
    });
    await prisma.user.deleteMany({ where: { email: { startsWith: tag } } });
    await prisma.auditLog.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.department.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.college.deleteMany({ where: { id: rivalCollegeId } });
    await app.close();
  });

  const analytics = (token: string, qs = '') =>
    http.get(`/api/v1/results/analytics${qs}`).set(auth(token));

  // ══════════════════ N-1 ══════════════════

  describe('N-1 — analytics examId validation and tenancy', () => {
    it('D. positive control: a valid own-tenant examId returns only that exam', async () => {
      const res = await analytics(adminToken, `?examId=${ownExamId}`);
      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe(`${tag}-own-exam`);
      expect(res.body.data.papers).toHaveLength(1);
      expect(res.body.data.papers[0].paperId).toBe(ownPaperId);
    });

    it('A. an OMITTED examId is rejected and cannot widen the result set', async () => {
      const res = await analytics(adminToken);
      // Before the fix this returned 200 with every paper in every college.
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.data).toBeUndefined();
      // and absolutely no paper data leaked in the error envelope
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('paperId');
      expect(body).not.toContain(RIVAL_COURSE_CODE);
      expect(body).not.toContain('RIVALROOM');
    });

    it('B. an EMPTY or unknown examId does not widen the result set', async () => {
      const empty = await analytics(adminToken, '?examId=');
      expect([400, 404]).toContain(empty.status);
      expect(empty.body.data).toBeUndefined();

      const unknown = await analytics(adminToken, '?examId=ckdoesnotexist000000');
      expect(unknown.status).toBe(404);
      expect(unknown.body.data).toBeUndefined();
    });

    it('C/G. an ARRAY or duplicated examId is a controlled 400, never a 500', async () => {
      for (const qs of [
        '?examId[]=a&examId[]=b',
        `?examId=${ownExamId}&examId=${rivalExamId}`,
        '?examId[a]=b',
      ]) {
        const res = await analytics(adminToken, qs);
        expect(res.status).toBe(400);
        expect(res.status).not.toBe(500);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.data).toBeUndefined();
      }
    });

    it('E. a rival-college examId cannot return rival data', async () => {
      const res = await analytics(adminToken, `?examId=${rivalExamId}`);
      expect(res.status).toBe(404);
      expect(res.body.data).toBeUndefined();
      const body = JSON.stringify(res.body);
      expect(body).not.toContain(RIVAL_COURSE_CODE);
      expect(body).not.toContain('RIVALROOM');
      expect(body).not.toContain(rivalPaperId);
    });

    it('E2. a rival-college paper can never appear in an authorized response', async () => {
      // Defence in depth (O-1): even a valid own exam must not pull foreign
      // papers, because ExamPaper has no collegeId of its own.
      const res = await analytics(adminToken, `?examId=${ownExamId}`);
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain(rivalPaperId);
      expect(body).not.toContain(RIVAL_COURSE_CODE);
      expect(body).not.toContain('RIVALROOM');
      expect(res.body.data.papers.every((p: { maxMarks: string }) => p.maxMarks !== '200')).toBe(true);
    });

    it('F. the permission boundary is unchanged for every principal', async () => {
      for (const [name, token] of [
        ['teacher', teacherToken],
        ['student', studentToken],
        ['accountant', accountantToken],
      ] as const) {
        const res = await analytics(token, `?examId=${ownExamId}`);
        expect(res.status).toBe(403);
        // and an omitted parameter must not become a softer failure
        const omitted = await analytics(token);
        expect([400, 403]).toContain(omitted.status);
        expect(omitted.body.data).toBeUndefined();
        expect(name).toBeTruthy();
      }
      const anon = await http.get('/api/v1/results/analytics');
      expect(anon.status).toBe(401);
    });

    it('client-supplied collegeId cannot widen or redirect the query', async () => {
      const res = await analytics(
        adminToken,
        `?examId=${ownExamId}&collegeId=${rivalCollegeId}&scope=ALL`,
      );
      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe(`${tag}-own-exam`);
      expect(JSON.stringify(res.body)).not.toContain(RIVAL_COURSE_CODE);
    });
  });

  // ══════════════════ N-13 ══════════════════

  describe('N-13 — analytics is a read and must work on a CLOSED term', () => {
    it('a CLOSED term still serves analytics', async () => {
      const res = await analytics(adminToken, `?examId=${closedExamId}`);
      // Before the fix this was 409 TERM_CLOSED on a pure read.
      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe(`${tag}-closed-exam`);
      expect(res.body.data.papers).toHaveLength(1);
    });

    it('CLOSED-term WRITE enforcement is unchanged', async () => {
      const write = await http
        .patch(`/api/v1/exams/${closedExamId}`)
        .set(auth(adminToken))
        .send({ title: `${tag}-should-not-apply` });
      expect(write.status).toBeGreaterThanOrEqual(400);
      const row = await prisma.exam.findUniqueOrThrow({ where: { id: closedExamId } });
      expect(row.title).toBe(`${tag}-closed-exam`);
    });
  });

  // ══════════════════ N-5 ══════════════════

  describe('N-5 — calendar-invalid dates are rejected, not 500s', () => {
    it('attendance.csv rejects a syntactically-valid but impossible date', async () => {
      for (const qs of ['?from=2024-13-45', '?to=2024-02-30', '?from=0000-99-99', '?from=2024-04-31']) {
        const res = await http
          .get(`/api/v1/exports/attendance.csv${qs}`)
          .set(auth(adminToken));
        // Before the fix: 500 INTERNAL_ERROR.
        expect(res.status).toBe(400);
        expect(res.status).not.toBe(500);
      }
    });

    it('attendance.csv still accepts real dates, including a leap day', async () => {
      for (const qs of ['', '?from=2024-02-29', '?from=2038-08-01&to=2038-12-20']) {
        const res = await http
          .get(`/api/v1/exports/attendance.csv${qs}`)
          .set(auth(adminToken));
        expect(res.status).toBe(200);
        expect(res.text.split(/\r?\n/)[0]).toBe(
          'date,course,section,rollNo,admissionNo,student,status',
        );
      }
    });

    it('session generation rejects an impossible weekOf instead of bypassing OUTSIDE_TERM', async () => {
      const res = await http
        .post(`/api/v1/sections/${openSectionId}/sessions/generate`)
        .set(auth(adminToken))
        .send({ weekOf: '2024-13-45' });
      expect(res.status).toBe(400);
      expect(res.status).not.toBe(500);
      // no sessions were created by the malformed request
      expect(
        await prisma.classSession.count({ where: { sectionId: openSectionId } }),
      ).toBe(0);
    });

    it('the OUTSIDE_TERM guard still works for a real out-of-range week', async () => {
      const res = await http
        .post(`/api/v1/sections/${openSectionId}/sessions/generate`)
        .set(auth(adminToken))
        .send({ weekOf: '2020-01-06' });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).not.toBe(500);
      expect(
        await prisma.classSession.count({ where: { sectionId: openSectionId } }),
      ).toBe(0);
    });

    it('session listing rejects an impossible date range', async () => {
      const res = await http
        .get(`/api/v1/sections/${openSectionId}/sessions?from=2024-02-30`)
        .set(auth(adminToken));
      expect(res.status).toBe(400);
      expect(res.status).not.toBe(500);
    });
  });

  // ══════════════════ N-25 ══════════════════

  describe('N-25 — malformed percent-encoding in the file key', () => {
    it('a malformed escape is a controlled 400, not a 500', async () => {
      for (const url of [
        '/api/v1/files/%zz',
        '/api/v1/files/%',
        '/api/v1/files/abc%',
      ]) {
        const res = await http
          .post('/api/v1/files/sign')
          .set(auth(adminToken))
          .send({ url });
        expect(res.status).toBe(400);
        expect(res.status).not.toBe(500);
      }
    });

    it('a well-formed but unknown key still follows the established path', async () => {
      const res = await http
        .post('/api/v1/files/sign')
        .set(auth(adminToken))
        .send({ url: '/api/v1/files/deadbeefdeadbeefdeadbeefdeadbeef-x.pdf' });
      // grandfathered/unknown keys are signed by the established M10 rules
      expect([200, 201, 404]).toContain(res.status);
      expect(res.status).not.toBe(500);
    });
  });

  // ══════════════════ N-1 array class variants ══════════════════

  describe('array-valued query parameters (N-1 class) never reach Prisma', () => {
    it('finalized-results reads reject array and duplicated studentId', async () => {
      for (const qs of [
        '?studentId[]=a&studentId[]=b',
        `?studentId=${studentProfileId}&studentId=other`,
      ]) {
        const t = await http.get(`/api/v1/results/transcript${qs}`).set(auth(adminToken));
        expect(t.status).toBe(400);
        expect(t.status).not.toBe(500);

        const r = await http
          .get(`/api/v1/results/report/term/${openTermId}${qs}`)
          .set(auth(adminToken));
        expect(r.status).toBe(400);
        expect(r.status).not.toBe(500);
      }
    });

    it('scalar studentId behaviour on those reads is unchanged', async () => {
      const ok = await http
        .get(`/api/v1/results/transcript?studentId=${studentProfileId}`)
        .set(auth(adminToken));
      expect(ok.status).toBe(200);
      expect(ok.body.data.studentId).toBe(studentProfileId);

      const missing = await http.get('/api/v1/results/transcript').set(auth(adminToken));
      expect(missing.status).toBe(400);
      expect(missing.body.error.code).toBe('MISSING_TARGET');

      const unknown = await http
        .get('/api/v1/results/transcript?studentId=ckdoesnotexist000000')
        .set(auth(adminToken));
      expect(unknown.status).toBe(404);
    });

    it('an EMPTY studentId keeps its prior meaning of "no target supplied"', async () => {
      // Backward-compatibility pin: the old controller did
      // `studentId || undefined`, so `?studentId=` was equivalent to
      // omitting it. Only the array/duplicate defect was fixed, so a wide
      // scope still gets MISSING_TARGET rather than a validation error...
      const wide = await http
        .get('/api/v1/results/transcript?studentId=')
        .set(auth(adminToken));
      expect(wide.status).toBe(400);
      expect(wide.body.error.code).toBe('MISSING_TARGET');

      // ...and an OWN-scope caller still reads their own record.
      const own = await http
        .get('/api/v1/results/transcript?studentId=')
        .set(auth(studentToken));
      expect(own.status).toBe(200);
      expect(own.body.data.studentId).toBeDefined();
    });

    it('the PUBLIC invite-info endpoint rejects an array token without a 500', async () => {
      const arr = await http.get('/api/v1/auth/invite-info?token[]=a&token[]=b');
      expect(arr.status).toBe(400);
      expect(arr.status).not.toBe(500);

      const omitted = await http.get('/api/v1/auth/invite-info');
      expect(omitted.status).toBe(400);
      expect(omitted.status).not.toBe(500);
    });
  });

  // ══════════════════ invariants ══════════════════

  describe('invariants', () => {
    it('no role-name conditional was introduced in the touched sources', async () => {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      for (const file of [
        'exams/exams.controller.ts',
        'exams/exams.service.ts',
        'exports/exports.module.ts',
        'files/files.controller.ts',
        'auth/auth.controller.ts',
        'common/filters/global-exception.filter.ts',
      ]) {
        const src = readFileSync(join(__dirname, '..', 'src', file), 'utf8');
        expect(src).not.toContain('user.role ===');
        for (const role of ['TEACHER', 'ACCOUNTANT', 'GUARDIAN']) {
          expect(src).not.toContain(`role === '${role}'`);
        }
      }
    });

    it('S-1 (M23-W1) remains closed', async () => {
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

    it('rival-tenant data was never mutated by any request in this suite', async () => {
      const paper = await prisma.examPaper.findUniqueOrThrow({ where: { id: rivalPaperId } });
      expect(Number(paper.maxMarks)).toBe(200);
      expect(paper.room).toBe('RIVALROOM');
      expect(await prisma.auditLog.count({ where: { collegeId: rivalCollegeId } })).toBe(0);
    });
  });
});
