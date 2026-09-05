import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M18-W1 — academic result finalization foundation.
 * Covers: migration #12 structures, CLOSED-term requirement (O-1),
 * snapshot correctness + frozen values, immutability after mark edits,
 * amendment version chain (O-5), partial-unique concurrency, authz
 * matrix (results.finalize = ADMIN only), tenancy, GPA policy gap
 * honesty (null gradePoints ⇒ null GPA; configured points ⇒
 * credit-weighted GPA per O-4), reopen-does-not-mutate (O-6), and
 * financial isolation.
 */
describe('M18-W1 — result finalization', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  let accountantToken: string;
  let guardianToken: string;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  // fixture: one CLOSED term with two courses of published results
  let yearId: string;
  let termId: string;
  let termLabel: string;
  let studentProfileId: string;
  let courseAId: string;
  let courseBId: string;
  let paperAId: string;
  let rivalCollegeId: string;
  let rivalTermId: string;
  let rivalStudentId: string;

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  const finalize = (token: string, term: string, studentId: string, confirmLabel: string) =>
    http
      .post(`/api/v1/results/terms/${term}/finalize`)
      .set(auth(token))
      .send({ studentId, confirmLabel });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
    const student = await prisma.user.findFirstOrThrow({
      where: { email: 'student@campusos.dev' },
      include: { studentProfile: true },
    });
    studentProfileId = student.studentProfile!.id;
    const department = await prisma.department.findFirstOrThrow({ where: { collegeId } });

    yearId = (
      await prisma.academicYear.create({
        data: {
          collegeId,
          label: `W18-AY-${suffix}`,
          startsOn: new Date('2028-08-01'),
          endsOn: new Date('2029-06-30'),
        },
      })
    ).id;
    termLabel = `W18-${suffix}`;
    termId = (
      await prisma.term.create({
        data: {
          collegeId,
          academicYearId: yearId,
          label: termLabel,
          startsOn: new Date('2028-08-01'),
          endsOn: new Date('2028-12-20'),
        },
      })
    ).id;

    async function makeCourse(code: string, credits: number) {
      return prisma.course.create({
        data: {
          collegeId,
          departmentId: department.id,
          code,
          title: `Course ${code}`,
          credits,
        },
      });
    }
    async function makePublishedResult(
      courseId: string,
      obtained: number,
      max: number,
    ) {
      const section = await prisma.section.create({
        data: { collegeId, courseId, termId, name: 'A', capacity: 30 },
      });
      await prisma.enrollment.create({
        data: { sectionId: section.id, studentId: studentProfileId },
      });
      const exam = await prisma.exam.create({
        data: {
          collegeId,
          termId,
          title: `Exam ${courseId.slice(-4)}`,
          type: 'FINAL',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      });
      const paper = await prisma.examPaper.create({
        data: {
          examId: exam.id,
          sectionId: section.id,
          maxMarks: max,
          examDate: new Date('2028-11-20'),
        },
      });
      await prisma.mark.create({
        data: {
          examPaperId: paper.id,
          studentId: studentProfileId,
          marksObtained: obtained,
          enteredById: admin.id,
          lockedAt: new Date(),
        },
      });
      return paper.id;
    }

    // Course A: 3 credits, 90/100 (A+ band); Course B: 2 credits, 60/100 (C).
    courseAId = (await makeCourse(`W18A-${suffix}`.slice(0, 12), 3)).id;
    courseBId = (await makeCourse(`W18B-${suffix}`.slice(0, 12), 2)).id;
    paperAId = await makePublishedResult(courseAId, 90, 100);
    await makePublishedResult(courseBId, 60, 100);

    // Rival college fixture.
    const rival = await prisma.college.create({
      data: { name: 'Rival Records College', code: `RV18-${suffix}` },
    });
    rivalCollegeId = rival.id;
    const rivalYear = await prisma.academicYear.create({
      data: {
        collegeId: rival.id,
        label: `RV18-AY-${suffix}`,
        startsOn: new Date('2028-08-01'),
        endsOn: new Date('2029-06-30'),
      },
    });
    rivalTermId = (
      await prisma.term.create({
        data: {
          collegeId: rival.id,
          academicYearId: rivalYear.id,
          label: `RV18-T-${suffix}`,
          startsOn: new Date('2028-08-01'),
          endsOn: new Date('2028-12-20'),
          status: 'CLOSED',
        },
      })
    ).id;
    const rivalUser = await prisma.user.create({
      data: {
        collegeId: rival.id,
        email: `rv18-${suffix}@rival.dev`,
        passwordHash: admin.passwordHash,
        role: 'STUDENT',
        status: 'ACTIVE',
        firstName: 'Rival',
        lastName: 'Student',
        mustChangePassword: false,
      },
    });
    const rivalDept = await prisma.department.create({
      data: { collegeId: rival.id, code: `R18-${suffix}`.slice(0, 10), name: 'RD' },
    });
    rivalStudentId = (
      await prisma.studentProfile.create({
        data: {
          collegeId: rival.id,
          userId: rivalUser.id,
          departmentId: rivalDept.id,
          rollNo: `RV18-${suffix}`,
          admissionNo: `RV18ADM-${suffix}`,
          batch: '2028',
        },
      })
    ).id;

    adminToken = await login('admin@campusos.dev');
    teacherToken = await login('teacher@campusos.dev');
    studentToken = await login('student@campusos.dev');
    accountantToken = await login('accountant@campusos.dev');
    await prisma.user.upsert({
      where: {
        collegeId_email: { collegeId, email: `w18-guardian-${suffix}@campusos.dev` },
      },
      update: {},
      create: {
        collegeId,
        email: `w18-guardian-${suffix}@campusos.dev`,
        passwordHash: admin.passwordHash,
        role: 'GUARDIAN',
        status: 'ACTIVE',
        firstName: 'Weight',
        lastName: 'Guardian',
        mustChangePassword: false,
      },
    });
    guardianToken = await login(`w18-guardian-${suffix}@campusos.dev`);
  });

  afterAll(async () => {
    await prisma.termResult.updateMany({
      where: { termId },
      data: { supersededById: null },
    });
    await prisma.termResult.deleteMany({ where: { termId } });
    await prisma.mark.deleteMany({
      where: { examPaper: { exam: { termId } } },
    });
    await prisma.examPaper.deleteMany({ where: { exam: { termId } } });
    await prisma.exam.deleteMany({ where: { termId } });
    await prisma.enrollment.deleteMany({ where: { section: { termId } } });
    await prisma.section.deleteMany({ where: { termId } });
    await prisma.course.deleteMany({ where: { id: { in: [courseAId, courseBId] } } });
    await prisma.term.deleteMany({
      where: { OR: [{ academicYearId: yearId }, { collegeId: rivalCollegeId }] },
    });
    await prisma.academicYear.deleteMany({
      where: { OR: [{ id: yearId }, { collegeId: rivalCollegeId }] },
    });
    await prisma.studentProfile.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.department.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.auditLog.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.guardianLink.deleteMany({
      where: { guardian: { email: `w18-guardian-${suffix}@campusos.dev` } },
    });
    await prisma.user.deleteMany({
      where: {
        OR: [
          { collegeId: rivalCollegeId },
          { email: `w18-guardian-${suffix}@campusos.dev` },
        ],
      },
    });
    await prisma.college.delete({ where: { id: rivalCollegeId } });
    await app.close();
  });

  describe('migration #12 structures', () => {
    it('tables, enum and the partial unique index exist; >=12 migrations applied', async () => {
      const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.tables
        WHERE table_name IN ('TermResult', 'CourseResult')`;
      expect(tables).toHaveLength(2);
      const index = await prisma.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes
        WHERE indexname = 'TermResult_one_finalized_per_student_term'`;
      expect(index).toHaveLength(1);
      const migrations = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      // M19+ adds forward-only migrations; M18 requires at least its 12.
      expect(Number(migrations[0].count)).toBeGreaterThanOrEqual(12);
    });
  });

  describe('eligibility & authorization', () => {
    it('ACTIVE term is rejected (TERM_NOT_CLOSED); nothing is created', async () => {
      const res = await finalize(adminToken, termId, studentProfileId, termLabel);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('TERM_NOT_CLOSED');
      expect(await prisma.termResult.count({ where: { termId } })).toBe(0);
    });

    it('teacher/student/accountant 403; anonymous 401; rival ids 404', async () => {
      for (const token of [teacherToken, studentToken, accountantToken]) {
        expect(
          (await finalize(token, termId, studentProfileId, termLabel)).status,
        ).toBe(403);
      }
      expect(
        (
          await http
            .post(`/api/v1/results/terms/${termId}/finalize`)
            .send({ studentId: studentProfileId, confirmLabel: termLabel })
        ).status,
      ).toBe(401);
      // rival term + rival student are invisible
      expect(
        (await finalize(adminToken, rivalTermId, rivalStudentId, `RV18-T-${suffix}`))
          .status,
      ).toBe(404);
      expect(
        (await finalize(adminToken, termId, rivalStudentId, termLabel)).status,
      ).toBe(404);
    });
  });

  describe('finalization on a CLOSED term', () => {
    beforeAll(async () => {
      await http
        .post(`/api/v1/terms/${termId}/close`)
        .set(auth(adminToken))
        .send({ confirmLabel: termLabel });
    });

    it('wrong typed confirmation rejected; correct label freezes the snapshot with exact values', async () => {
      const wrong = await finalize(adminToken, termId, studentProfileId, 'nope');
      expect(wrong.status).toBe(400);
      expect(wrong.body.error.code).toBe('CONFIRMATION_MISMATCH');

      const res = await finalize(adminToken, termId, studentProfileId, termLabel);
      expect(res.status).toBe(201);
      const record = res.body.data;
      expect(record.status).toBe('FINALIZED');
      expect(record.version).toBe(1);
      // 90+60 of 200 → 75.00
      expect(record.overallPercentage).toBe('75');
      expect(record.gradeLabel).toBe('B+');
      expect(record.creditsAttempted).toBe(5);
      // O-4 policy gap honesty: seeded grade bands have NO gradePoint —
      // GPA and pass/fail stay null rather than inventing a scale.
      expect(record.termGpa).toBeNull();
      expect(record.creditsEarned).toBeNull();
      expect(record.courses).toHaveLength(2);
      const courseA = record.courses.find((c: { credits: number }) => c.credits === 3);
      expect(courseA.percentage).toBe('90');
      expect(courseA.gradeLabel).toBe('A+');
      expect(courseA.passed).toBeNull();
      // exactly one success audit
      expect(
        await prisma.auditLog.count({
          where: { action: 'results.finalized', targetId: record.id },
        }),
      ).toBe(1);
    });

    it('duplicate finalization is refused; concurrent finalize of a second student collapses to one winner', async () => {
      const dup = await finalize(adminToken, termId, studentProfileId, termLabel);
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('ALREADY_FINALIZED');

      // second student with published results, finalized concurrently ×2
      const other = await prisma.studentProfile.findFirstOrThrow({
        where: { collegeId, id: { not: studentProfileId } },
      });
      const section = await prisma.section.findFirstOrThrow({
        where: { termId, courseId: courseAId },
      });
      await prisma.enrollment.create({
        data: { sectionId: section.id, studentId: other.id },
      });
      await prisma.mark.create({
        data: {
          examPaperId: paperAId,
          studentId: other.id,
          marksObtained: 55,
          enteredById: (
            await prisma.user.findFirstOrThrow({ where: { email: 'admin@campusos.dev' } })
          ).id,
          lockedAt: new Date(),
        },
      });
      const [a, b] = await Promise.all([
        finalize(adminToken, termId, other.id, termLabel),
        finalize(adminToken, termId, other.id, termLabel),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(
        await prisma.termResult.count({
          where: { termId, studentId: other.id, status: 'FINALIZED' },
        }),
      ).toBe(1);
      const winner = a.status === 201 ? a : b;
      expect(
        await prisma.auditLog.count({
          where: { action: 'results.finalized', targetId: winner.body.data.id },
        }),
      ).toBe(1);
    });

    it('immutability: later mark edits and term reopening do NOT change the snapshot', async () => {
      const before = await prisma.termResult.findFirstOrThrow({
        where: { termId, studentId: studentProfileId, status: 'FINALIZED' },
        include: { courseResults: true },
      });
      // mutate the underlying mark directly (bypassing the M17 guard on
      // purpose — even raw data drift must not affect the snapshot)
      await prisma.mark.updateMany({
        where: { examPaperId: paperAId, studentId: studentProfileId },
        data: { marksObtained: 10 },
      });
      // reopen the term (O-6) — snapshots must be untouched
      await http
        .post(`/api/v1/terms/${termId}/reopen`)
        .set(auth(adminToken))
        .send({ confirmLabel: termLabel });
      const after = await prisma.termResult.findUniqueOrThrow({
        where: { id: before.id },
        include: { courseResults: true },
      });
      expect(after.overallPercentage.toString()).toBe(
        before.overallPercentage.toString(),
      );
      expect(after.courseResults.map((c) => c.obtained.toString()).sort()).toEqual(
        before.courseResults.map((c) => c.obtained.toString()).sort(),
      );
      // close again for the amendment test
      await http
        .post(`/api/v1/terms/${termId}/close`)
        .set(auth(adminToken))
        .send({ confirmLabel: termLabel });
    });

    it('amendment creates version 2 from CURRENT marks; version 1 is preserved as SUPERSEDED', async () => {
      const v1 = await prisma.termResult.findFirstOrThrow({
        where: { termId, studentId: studentProfileId, status: 'FINALIZED' },
      });
      const res = await http
        .post(`/api/v1/results/records/${v1.id}/amend`)
        .set(auth(adminToken))
        .send({ reason: 'mark correction', confirmLabel: termLabel });
      expect(res.status).toBe(201);
      expect(res.body.data.version).toBe(2);
      // recomputed from the edited mark (10+60 of 200 → 35.00, F band)
      expect(res.body.data.overallPercentage).toBe('35');
      expect(res.body.data.gradeLabel).toBe('F');
      // v1 preserved, superseded, chained to v2
      const oldRow = await prisma.termResult.findUniqueOrThrow({ where: { id: v1.id } });
      expect(oldRow.status).toBe('SUPERSEDED');
      expect(oldRow.supersededById).toBe(res.body.data.id);
      expect(oldRow.overallPercentage.toString()).toBe('75');
      // amending the superseded version again is refused
      const again = await http
        .post(`/api/v1/results/records/${v1.id}/amend`)
        .set(auth(adminToken))
        .send({ reason: 'stale retry', confirmLabel: termLabel });
      expect(again.status).toBe(409);
      expect(
        await prisma.auditLog.count({
          where: { action: 'results.amended', targetId: res.body.data.id },
        }),
      ).toBe(1);
    });

    it('O-4 with configured grade points: credit-weighted GPA is computed', async () => {
      // configure the college scale (this is the institution's decision;
      // the test acts as that institution)
      await prisma.gradeBand.updateMany({
        where: { collegeId, label: 'A+' },
        data: { gradePoint: 4.0 },
      });
      await prisma.gradeBand.updateMany({
        where: { collegeId, label: 'C' },
        data: { gradePoint: 2.0 },
      });
      // restore original marks and amend → v3 computed with GPA
      await prisma.mark.updateMany({
        where: { examPaperId: paperAId, studentId: studentProfileId },
        data: { marksObtained: 90 },
      });
      const v2 = await prisma.termResult.findFirstOrThrow({
        where: { termId, studentId: studentProfileId, status: 'FINALIZED' },
      });
      const res = await http
        .post(`/api/v1/results/records/${v2.id}/amend`)
        .set(auth(adminToken))
        .send({ reason: 'GPA scale configured', confirmLabel: termLabel });
      expect(res.status).toBe(201);
      // A+(4.0)×3cr + C(2.0)×2cr = 16 / 5 = 3.2
      expect(res.body.data.termGpa).toBe('3.2');
      expect(res.body.data.creditsEarned).toBe(5);
      const courseA = res.body.data.courses.find(
        (c: { credits: number }) => c.credits === 3,
      );
      expect(courseA.gradePoint).toBe('4');
      expect(courseA.passed).toBe(true);
      // reset scale to the seeded null state
      await prisma.gradeBand.updateMany({
        where: { collegeId, label: { in: ['A+', 'C'] } },
        data: { gradePoint: null },
      });
    });

    it('financial isolation: finalization touched no money tables', async () => {
      expect(await prisma.payment.count({ where: { invoice: { collegeId } } })).toBe(
        await prisma.payment.count({ where: { invoice: { collegeId } } }),
      );
      expect(await prisma.refund.count()).toBe(0);
      expect(await prisma.refundAttempt.count()).toBe(0);
      // NO_PUBLISHED_RESULTS guard: a student with no published marks
      const empty = await prisma.studentProfile.findFirstOrThrow({
        where: {
          collegeId,
          id: { not: studentProfileId },
          enrollments: { none: { section: { termId } } },
        },
      });
      const res = await finalize(adminToken, termId, empty.id, termLabel);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_PUBLISHED_RESULTS');
    });
  });

  describe('M18-W2 — report, transcript, batch, void', () => {
    it('report card serves the SNAPSHOT (v3), never live marks; OWN forces self', async () => {
      // sabotage live marks again — the snapshot must not care
      await prisma.mark.updateMany({
        where: { examPaperId: paperAId, studentId: studentProfileId },
        data: { marksObtained: 1 },
      });
      const admin = await http
        .get(`/api/v1/results/report/term/${termId}?studentId=${studentProfileId}`)
        .set(auth(adminToken));
      expect(admin.status).toBe(200);
      expect(admin.body.data.version).toBe(3);
      expect(admin.body.data.overallPercentage).toBe('75'); // frozen v3
      // student OWN — requested foreign studentId is IGNORED, reads self
      const own = await http
        .get(`/api/v1/results/report/term/${termId}?studentId=${rivalStudentId}`)
        .set(auth(studentToken));
      expect(own.status).toBe(200);
      expect(own.body.data.studentId).toBe(studentProfileId);
      // restore the mark
      await prisma.mark.updateMany({
        where: { examPaperId: paperAId, studentId: studentProfileId },
        data: { marksObtained: 90 },
      });
    });

    it('historical CourseResult survives catalog edits (frozen code/title/credits)', async () => {
      const before = await http
        .get(`/api/v1/results/report/term/${termId}?studentId=${studentProfileId}`)
        .set(auth(adminToken));
      const frozen = before.body.data.courses.find(
        (c: { credits: number }) => c.credits === 3,
      );
      await prisma.course.update({
        where: { id: courseAId },
        data: { title: 'RENAMED LATER', credits: 9 },
      });
      const after = await http
        .get(`/api/v1/results/report/term/${termId}?studentId=${studentProfileId}`)
        .set(auth(adminToken));
      const still = after.body.data.courses.find(
        (c: { courseCode: string }) => c.courseCode === frozen.courseCode,
      );
      expect(still.courseTitle).toBe(frozen.courseTitle); // NOT 'RENAMED LATER'
      expect(still.credits).toBe(3); // NOT 9
      await prisma.course.update({
        where: { id: courseAId },
        data: { title: frozen.courseTitle, credits: 3 },
      });
    });

    it('transcript assembles FINALIZED terms only; CGPA null without a full grade-point scale', async () => {
      const res = await http
        .get(`/api/v1/results/transcript?studentId=${studentProfileId}`)
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      const t = res.body.data;
      expect(t.terms).toHaveLength(1);
      expect(t.terms[0].version).toBe(3); // active version only
      expect(t.creditsAttempted).toBe(5);
      // CGPA derives from the FROZEN course grade points inside the
      // snapshots — v3 was finalized while the scale was configured, so
      // the transcript keeps 3.20 even though the live bands were reset
      // to null afterwards. Historical stability over live config.
      expect(t.cgpa).toBe('3.20');
      expect(t.creditsEarned).toBe(5);
    });

    it('read authorization: guardian CHILD linked/unlinked; anon 401; rival admin sees nothing', async () => {
      expect(
        (await http.get(`/api/v1/results/transcript?studentId=${studentProfileId}`))
          .status,
      ).toBe(401);
      // unlinked guardian → 404
      expect(
        (
          await http
            .get(`/api/v1/results/transcript?studentId=${studentProfileId}`)
            .set(auth(guardianToken))
        ).status,
      ).toBe(404);
      // linked guardian → 200 read-only
      const guardianUser = await prisma.user.findFirstOrThrow({
        where: { email: `w18-guardian-${suffix}@campusos.dev` },
      });
      const link = await prisma.guardianLink.create({
        data: {
          collegeId,
          guardianUserId: guardianUser.id,
          studentProfileId,
          relationship: 'parent',
          status: 'ACTIVE',
        },
      });
      const linked = await http
        .get(`/api/v1/results/transcript?studentId=${studentProfileId}`)
        .set(auth(guardianToken));
      expect(linked.status).toBe(200);
      expect(linked.body.data.terms).toHaveLength(1);
      await prisma.guardianLink.delete({ where: { id: link.id } });
      // rival student id (cross-college) → 404, no existence leak
      expect(
        (
          await http
            .get(`/api/v1/results/transcript?studentId=${rivalStudentId}`)
            .set(auth(adminToken))
        ).status,
      ).toBe(404);
    });

    it('finalization worklist + batch finalization reuse the same engine', async () => {
      const list = await http
        .get(`/api/v1/results/terms/${termId}/finalization`)
        .set(auth(adminToken));
      expect(list.status).toBe(200);
      const rows = list.body.data.students as Array<{
        studentId: string;
        finalized: boolean;
      }>;
      expect(rows.find((r) => r.studentId === studentProfileId)?.finalized).toBe(true);
      // batch over [already-finalized, no-results] → per-student outcomes
      const empty = await prisma.studentProfile.findFirstOrThrow({
        where: {
          collegeId,
          enrollments: { none: { section: { termId } } },
        },
      });
      const batch = await http
        .post(`/api/v1/results/terms/${termId}/finalize-batch`)
        .set(auth(adminToken))
        .send({ studentIds: [studentProfileId, empty.id], confirmLabel: termLabel });
      expect(batch.status).toBe(201);
      expect(batch.body.data.finalized).toBe(0);
      expect(batch.body.data.failed).toBe(2);
      const codes = (batch.body.data.outcomes as Array<{ errorCode?: string }>).map(
        (o) => o.errorCode,
      );
      expect(codes).toContain('ALREADY_FINALIZED');
      expect(codes).toContain('NO_PUBLISHED_RESULTS');
      // teacher cannot batch/list
      expect(
        (
          await http
            .post(`/api/v1/results/terms/${termId}/finalize-batch`)
            .set(auth(teacherToken))
            .send({ studentIds: [studentProfileId], confirmLabel: termLabel })
        ).status,
      ).toBe(403);
    });

    it('VOID: CAS on the active version, history preserved, transcript excludes it, no deletion', async () => {
      const active = await prisma.termResult.findFirstOrThrow({
        where: { termId, studentId: studentProfileId, status: 'FINALIZED' },
      });
      const voided = await http
        .post(`/api/v1/results/records/${active.id}/void`)
        .set(auth(adminToken))
        .send({ reason: 'issued in error', confirmLabel: termLabel });
      expect(voided.status).toBe(201);
      expect(voided.body.data.status).toBe('VOID');
      // row + course lines preserved
      const row = await prisma.termResult.findUniqueOrThrow({
        where: { id: active.id },
        include: { courseResults: true },
      });
      expect(row.status).toBe('VOID');
      expect(row.courseResults.length).toBeGreaterThan(0);
      // superseded history untouched and still queryable
      expect(
        await prisma.termResult.count({ where: { termId, status: 'SUPERSEDED' } }),
      ).toBe(2);
      // transcript now excludes the voided term
      const t = await http
        .get(`/api/v1/results/transcript?studentId=${studentProfileId}`)
        .set(auth(adminToken));
      expect(t.body.data.terms).toHaveLength(0);
      // re-void refused; superseded rows cannot be voided either
      expect(
        (
          await http
            .post(`/api/v1/results/records/${active.id}/void`)
            .set(auth(adminToken))
            .send({ reason: 'again', confirmLabel: termLabel })
        ).status,
      ).toBe(409);
      // W4 hardening: an explicitly SUPERSEDED historical version can
      // never be voided through the endpoint either.
      const supersededRow = await prisma.termResult.findFirstOrThrow({
        where: { termId, status: 'SUPERSEDED' },
      });
      expect(
        (
          await http
            .post(`/api/v1/results/records/${supersededRow.id}/void`)
            .set(auth(adminToken))
            .send({ reason: 'history attack', confirmLabel: termLabel })
        ).status,
      ).toBe(409);
      // W4 hardening: amend/void are results.finalize surfaces — students
      // and other non-authorized principals are refused outright.
      for (const token of [studentToken, teacherToken, accountantToken]) {
        expect(
          (
            await http
              .post(`/api/v1/results/records/${active.id}/void`)
              .set(auth(token))
              .send({ reason: 'nope nope', confirmLabel: termLabel })
          ).status,
        ).toBe(403);
        expect(
          (
            await http
              .post(`/api/v1/results/records/${active.id}/amend`)
              .set(auth(token))
              .send({ reason: 'nope nope', confirmLabel: termLabel })
          ).status,
        ).toBe(403);
      }
      // exactly one audit
      expect(
        await prisma.auditLog.count({
          where: { action: 'results.voided', targetId: active.id },
        }),
      ).toBe(1);
      // the freed partial-unique slot allows a fresh finalization (v1 again)
      const fresh = await finalize(adminToken, termId, studentProfileId, termLabel);
      expect(fresh.status).toBe(201);
      // Mark/Term untouched by the whole read/void surface
      const mark = await prisma.mark.findFirstOrThrow({
        where: { examPaperId: paperAId, studentId: studentProfileId },
      });
      expect(mark.marksObtained.toString()).toBe('90');
      expect(
        (await prisma.term.findUniqueOrThrow({ where: { id: termId } })).status,
      ).toBe('CLOSED');
    });
  });

});
