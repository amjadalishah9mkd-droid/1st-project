import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M15-W2 — term rollover engine (locked D1–D8).
 * Fully isolated fixture inside the demo college (own year/terms/courses/
 * sections/students/teacher) plus a rival college with its own admin.
 */
describe('M15-W2 — term rollover engine', () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const sfx = Date.now().toString(36);
  let collegeId: string;
  let departmentId: string;
  let rivalCollegeId: string;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  let rivalAdminToken: string;

  let fromTermId: string;
  let toTermId: string;
  let toTerm2Id: string; // failure-injection target
  let rivalToTermId: string;
  let courseAId: string; // BUS-101 analogue
  let courseBId: string; // BUS-102 analogue (MAP target)
  let courseCId: string; // failure-injection MAP target (deleted mid-flight)
  let secA: string; // CLONE, graduate=false
  let secB: string; // MAP to courseB
  let secC: string; // SKIP
  let secFinal: string; // graduateStudents
  let teacherProfileId: string;
  let teacher2ProfileId: string;
  const students: Record<string, string> = {}; // key -> studentProfileId
  const madeUserIds: string[] = [];

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function makeStudent(key: string, status: 'ENROLLED' | 'WITHDRAWN' | 'SUSPENDED') {
    const user = await prisma.user.create({
      data: {
        collegeId,
        email: `w2ro-${key}-${sfx}@campusos.dev`,
        role: 'STUDENT',
        firstName: `Ro${key}`,
        lastName: 'Student',
        mustChangePassword: false,
      },
    });
    madeUserIds.push(user.id);
    const profile = await prisma.studentProfile.create({
      data: {
        userId: user.id,
        collegeId,
        departmentId,
        admissionNo: `RO-${key}-${sfx}`,
        rollNo: `ROR-${key}-${sfx}`,
        batch: '2026',
        status,
      },
    });
    students[key] = profile.id;
    return profile.id;
  }

  const enroll = (studentId: string, sectionId: string) =>
    prisma.enrollment.create({ data: { studentId, sectionId } });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
    departmentId = (
      await prisma.department.findFirstOrThrow({ where: { collegeId } })
    ).id;

    // Isolated calendar fixture.
    const year = await prisma.academicYear.create({
      data: {
        collegeId,
        label: `RO-AY-${sfx}`,
        startsOn: new Date('2030-08-01'),
        endsOn: new Date('2031-06-30'),
      },
    });
    const mkTerm = (label: string, s: string, e: string) =>
      prisma.term.create({
        data: {
          collegeId,
          academicYearId: year.id,
          label,
          startsOn: new Date(s),
          endsOn: new Date(e),
        },
      });
    fromTermId = (await mkTerm(`RO-Fall-${sfx}`, '2030-08-01', '2030-12-20')).id;
    toTermId = (await mkTerm(`RO-Spring-${sfx}`, '2031-01-05', '2031-05-20')).id;
    toTerm2Id = (await mkTerm(`RO-Summer-${sfx}`, '2031-06-01', '2031-06-28')).id;

    const mkCourse = (code: string) =>
      prisma.course.create({
        data: { collegeId, departmentId, code: `${code}-${sfx}`, title: code, credits: 3 },
      });
    courseAId = (await mkCourse('ROA')).id;
    courseBId = (await mkCourse('ROB')).id;
    courseCId = (await mkCourse('ROC')).id;

    const mkSection = (name: string, courseId: string) =>
      prisma.section.create({
        data: { collegeId, courseId, termId: fromTermId, name, capacity: 30 },
      });
    secA = (await mkSection('A', courseAId)).id;
    secB = (await mkSection('B', courseAId)).id;
    secC = (await mkSection('C', courseAId)).id;
    secFinal = (await mkSection('F', courseBId)).id;

    // Teacher fixture (own, to avoid demo coupling).
    for (const [i, holder] of (['t1', 't2'] as const).entries()) {
      const user = await prisma.user.create({
        data: {
          collegeId,
          email: `w2ro-${holder}-${sfx}@campusos.dev`,
          role: 'TEACHER',
          firstName: `RoT${i}`,
          lastName: 'Teacher',
          mustChangePassword: false,
        },
      });
      madeUserIds.push(user.id);
      const profile = await prisma.teacherProfile.create({
        data: {
          userId: user.id,
          collegeId,
          departmentId,
          employeeNo: `ROT-${holder}-${sfx}`,
          designation: 'Lecturer',
          joinedOn: new Date('2026-01-01'),
        },
      });
      if (holder === 't1') teacherProfileId = profile.id;
      else teacher2ProfileId = profile.id;
    }
    await prisma.teachingAssignment.create({
      data: { teacherId: teacherProfileId, sectionId: secA },
    });
    await prisma.teachingAssignment.create({
      data: { teacherId: teacherProfileId, sectionId: secB },
    });

    // Students: carry, hold, exclude, withdrawn, suspended, graduating.
    await makeStudent('carry', 'ENROLLED');
    await makeStudent('hold', 'ENROLLED');
    await makeStudent('excl', 'ENROLLED');
    await makeStudent('wd', 'WITHDRAWN');
    await makeStudent('susp', 'SUSPENDED');
    await makeStudent('grad', 'ENROLLED');
    await makeStudent('skip', 'ENROLLED');
    await enroll(students.carry, secA);
    await enroll(students.hold, secB);
    await enroll(students.excl, secA);
    await enroll(students.wd, secA);
    await enroll(students.susp, secA);
    await enroll(students.grad, secFinal);
    await enroll(students.skip, secC);

    // Rival college + rival admin.
    const rival = await prisma.college.create({
      data: { name: 'Rival RO College', code: `RVRO-${sfx}` },
    });
    rivalCollegeId = rival.id;
    const rivalYear = await prisma.academicYear.create({
      data: {
        collegeId: rival.id,
        label: `RV-AY-${sfx}`,
        startsOn: new Date('2030-08-01'),
        endsOn: new Date('2031-06-30'),
      },
    });
    rivalToTermId = (
      await prisma.term.create({
        data: {
          collegeId: rival.id,
          academicYearId: rivalYear.id,
          label: `RV-T-${sfx}`,
          startsOn: new Date('2031-01-05'),
          endsOn: new Date('2031-05-20'),
        },
      })
    ).id;
    const argon2 = await import('argon2');
    const rivalAdmin = await prisma.user.create({
      data: {
        collegeId: rival.id,
        email: `w2ro-radmin-${sfx}@campusos.dev`,
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
  });

  afterAll(async () => {
    const termIds = [fromTermId, toTermId, toTerm2Id, rivalToTermId];
    await prisma.termRollover.deleteMany({});
    await prisma.enrollment.deleteMany({ where: { section: { termId: { in: termIds } } } });
    await prisma.teachingAssignment.deleteMany({
      where: { section: { termId: { in: termIds } } },
    });
    await prisma.section.deleteMany({ where: { termId: { in: termIds } } });
    await prisma.term.deleteMany({ where: { id: { in: termIds } } });
    await prisma.academicYear.deleteMany({ where: { label: { contains: `AY-${sfx}` } } });
    await prisma.course.deleteMany({ where: { code: { contains: sfx } } });
    await prisma.studentProfile.deleteMany({
      where: { id: { in: Object.values(students) } },
    });
    await prisma.teacherProfile.deleteMany({
      where: { id: { in: [teacherProfileId, teacher2ProfileId] } },
    });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ collegeId: rivalCollegeId }, { actorId: { in: madeUserIds } }] },
    });
    await prisma.user.deleteMany({ where: { id: { in: madeUserIds } } });
    await prisma.college.delete({ where: { id: rivalCollegeId } });
    await app.close();
  });

  describe('authorization & tenancy', () => {
    it('teacher/student 403, anonymous 401 on every rollover surface', async () => {
      for (const token of [teacherToken, studentToken]) {
        expect(
          (
            await http
              .post(`/api/v1/terms/${toTermId}/rollover`)
              .set(auth(token))
              .send({ fromTermId })
          ).status,
        ).toBe(403);
        expect(
          (await http.get(`/api/v1/terms/${toTermId}/rollover`).set(auth(token))).status,
        ).toBe(403);
        expect(
          (
            await http
              .post(`/api/v1/terms/${toTermId}/rollover/execute`)
              .set(auth(token))
              .send({ confirmLabel: 'x' })
          ).status,
        ).toBe(403);
      }
      expect(
        (await http.post(`/api/v1/terms/${toTermId}/rollover`).send({ fromTermId })).status,
      ).toBe(401);
    });

    it('rival-college targets/sources are invisible; rival admin cannot touch our draft', async () => {
      // Our admin cannot target a rival term or use a rival source.
      expect(
        (
          await http
            .post(`/api/v1/terms/${rivalToTermId}/rollover`)
            .set(auth(adminToken))
            .send({ fromTermId })
        ).status,
      ).toBe(404);
      expect(
        (
          await http
            .post(`/api/v1/terms/${toTermId}/rollover`)
            .set(auth(adminToken))
            .send({ fromTermId: rivalToTermId })
        ).status,
      ).toBe(400); // INVALID_SOURCE_TERM
      // Rival admin sees nothing of ours.
      for (const [method, path, body] of [
        ['get', `/api/v1/terms/${toTermId}/rollover`, undefined],
        ['patch', `/api/v1/terms/${toTermId}/rollover`, { sections: [] }],
        [
          'post',
          `/api/v1/terms/${toTermId}/rollover/execute`,
          { confirmLabel: `RO-Spring-${sfx}` },
        ],
      ] as const) {
        const req = (http as any)[method](path).set(auth(rivalAdminToken));
        const res = body ? await req.send(body) : await req;
        expect(res.status).toBe(404);
      }
    });
  });

  describe('draft & suggested plan (D1/D4/D8 defaults)', () => {
    it('creates the draft with same-course clones, carried teachers and status-aware defaults', async () => {
      expect(
        (
          await http
            .post(`/api/v1/terms/${toTermId}/rollover`)
            .set(auth(adminToken))
            .send({ fromTermId: toTermId })
        ).status,
      ).toBe(400); // SAME_TERM

      const res = await http
        .post(`/api/v1/terms/${toTermId}/rollover`)
        .set(auth(adminToken))
        .send({ fromTermId });
      expect(res.status).toBe(201);
      const preview = res.body.data;
      expect(preview.status).toBe('DRAFT');
      expect(preview.sections).toHaveLength(4);
      const a = preview.sections.find((s: any) => s.sourceSectionId === secA);
      expect(a.action).toBe('CLONE');
      expect(a.teachers.some((t: any) => t.teacherId === teacherProfileId && t.carried)).toBe(true);
      const wd = a.students.find((s: any) => s.studentId === students.wd);
      expect(wd).toMatchObject({ decision: 'EXCLUDE', locked: true, status: 'WITHDRAWN' });
      const susp = a.students.find((s: any) => s.studentId === students.susp);
      expect(susp).toMatchObject({ decision: 'CARRY', flagged: true, status: 'SUSPENDED' });
      expect(preview.summary.suspendedFlags).toBe(1);

      // Idempotent create: resuming returns the same draft.
      const again = await http
        .post(`/api/v1/terms/${toTermId}/rollover`)
        .set(auth(adminToken))
        .send({ fromTermId });
      expect(again.status).toBe(201);
      expect(again.body.data.id).toBe(preview.id);
      expect(await prisma.termRollover.count({ where: { toTermId } })).toBe(1);
    });

    it('rejects a destination term that already has sections', async () => {
      const busySection = await prisma.section.create({
        data: {
          collegeId,
          courseId: courseAId,
          termId: toTerm2Id,
          name: 'Busy',
          capacity: 10,
        },
      });
      expect(
        (
          await http
            .post(`/api/v1/terms/${toTerm2Id}/rollover`)
            .set(auth(adminToken))
            .send({ fromTermId })
        ).status,
      ).toBe(400); // TARGET_TERM_NOT_EMPTY
      await prisma.section.delete({ where: { id: busySection.id } });
    });
  });

  describe('plan editing (D1/D2/D3 validations)', () => {
    function basePlan() {
      return {
        sections: [
          {
            sourceSectionId: secA,
            action: 'CLONE',
            targetName: 'A',
            graduateStudents: false,
            carryTeachers: true,
            teacherIds: [teacherProfileId],
            students: [
              { studentId: students.carry, decision: 'CARRY' },
              { studentId: students.excl, decision: 'EXCLUDE' },
              { studentId: students.wd, decision: 'CARRY' }, // locked → still excluded
              { studentId: students.susp, decision: 'CARRY' },
            ],
          },
          {
            sourceSectionId: secB,
            action: 'MAP',
            targetCourseId: courseBId, // "next semester course"
            targetName: 'B2',
            graduateStudents: false,
            carryTeachers: true,
            teacherIds: [teacher2ProfileId], // teacher override (D4)
            students: [
              { studentId: students.hold, decision: 'HOLD', holdSourceSectionId: secA },
            ],
          },
          {
            sourceSectionId: secC,
            action: 'SKIP',
            graduateStudents: false,
            carryTeachers: false,
            students: [{ studentId: students.skip, decision: 'CARRY' }],
          },
          {
            sourceSectionId: secFinal,
            action: 'CLONE',
            targetName: 'F-archive',
            graduateStudents: true, // D3: final section
            carryTeachers: false,
            students: [{ studentId: students.grad, decision: 'CARRY' }],
          },
        ],
      };
    }

    it('rejects invalid plans: MAP w/o course, HOLD w/o or with SKIP target, foreign sections', async () => {
      const patch = (plan: object) =>
        http.patch(`/api/v1/terms/${toTermId}/rollover`).set(auth(adminToken)).send(plan);

      const noCourse = basePlan();
      delete (noCourse.sections[1] as any).targetCourseId;
      expect((await patch(noCourse)).status).toBe(400);

      const noHoldTarget = basePlan();
      delete (noHoldTarget.sections[1].students[0] as any).holdSourceSectionId;
      expect((await patch(noHoldTarget)).status).toBe(400);

      const holdToSkip = basePlan();
      (holdToSkip.sections[1].students[0] as any).holdSourceSectionId = secC; // SKIP entry
      expect((await patch(holdToSkip)).status).toBe(400);

      const foreign = basePlan();
      (foreign.sections[0] as any).sourceSectionId = 'not-a-section';
      expect((await patch(foreign)).status).toBe(400);
    });

    it('accepts the valid edited plan and reflects it in the preview', async () => {
      const res = await http
        .patch(`/api/v1/terms/${toTermId}/rollover`)
        .set(auth(adminToken))
        .send(basePlan());
      expect(res.status).toBe(200);
      const preview = res.body.data;
      expect(preview.summary.graduates).toBe(1);
      expect(preview.summary.holds).toBe(1);
      const b = preview.sections.find((s: any) => s.sourceSectionId === secB);
      expect(b.action).toBe('MAP');
      expect(b.targetCourseId).toBe(courseBId);
    });
  });

  describe('execution (atomic, typed confirmation)', () => {
    it('wrong typed confirmation is refused; nothing changes', async () => {
      const res = await http
        .post(`/api/v1/terms/${toTermId}/rollover/execute`)
        .set(auth(adminToken))
        .send({ confirmLabel: 'wrong-label' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CONFIRMATION_MISMATCH');
      expect(await prisma.section.count({ where: { termId: toTermId } })).toBe(0);
    });

    it('executes the full D1–D8 matrix atomically', async () => {
      const res = await http
        .post(`/api/v1/terms/${toTermId}/rollover/execute`)
        .set(auth(adminToken))
        .send({ confirmLabel: `RO-Spring-${sfx}` });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('EXECUTED');

      const newSections = await prisma.section.findMany({
        where: { termId: toTermId },
        include: { teachingAssignments: true, enrollments: true },
      });
      expect(newSections).toHaveLength(3); // A clone, B2 map, F-archive (no SKIP)

      const newA = newSections.find((s) => s.name === 'A')!;
      expect(newA.courseId).toBe(courseAId); // CLONE keeps course
      expect(newA.teachingAssignments.map((t) => t.teacherId)).toEqual([teacherProfileId]);
      const aStudentIds = newA.enrollments.map((e) => e.studentId).sort();
      // carry + suspended carried (flagged) + HELD-BACK student from secB.
      expect(aStudentIds).toEqual(
        [students.carry, students.susp, students.hold].sort(),
      );
      // excluded / withdrawn / graduated never appear anywhere in the new term.
      const allNewEnrollments = newSections.flatMap((s) => s.enrollments.map((e) => e.studentId));
      for (const absent of [students.excl, students.wd, students.grad, students.skip]) {
        expect(allNewEnrollments).not.toContain(absent);
      }

      const newB = newSections.find((s) => s.name === 'B2')!;
      expect(newB.courseId).toBe(courseBId); // MAP switched course (D1)
      expect(newB.teachingAssignments.map((t) => t.teacherId)).toEqual([teacher2ProfileId]); // override (D4)

      // D3: graduation.
      const grad = await prisma.studentProfile.findUniqueOrThrow({
        where: { id: students.grad },
      });
      expect(grad.status).toBe('GRADUATED');

      // Old ACTIVE enrollments → COMPLETED; history intact.
      const oldEnrollments = await prisma.enrollment.findMany({
        where: { section: { termId: fromTermId } },
      });
      expect(oldEnrollments).toHaveLength(7);
      expect(oldEnrollments.every((e) => e.status === 'COMPLETED')).toBe(true);
      // Source sections untouched (still in the source term, same names).
      expect(
        await prisma.section.count({ where: { termId: fromTermId } }),
      ).toBe(4);

      // D5/D7: NOTHING else was created.
      expect(
        await prisma.timetableSlot.count({ where: { section: { termId: toTermId } } }),
      ).toBe(0);
      expect(
        await prisma.classSession.count({ where: { section: { termId: toTermId } } }),
      ).toBe(0);
      expect(
        await prisma.invoice.count({ where: { student: { id: { in: Object.values(students) } } } }),
      ).toBe(0);
      expect(await prisma.paymentAttempt.count()).toBe(0);

      // Audit: ids/counters only.
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'terms.rollover_executed', targetId: toTermId },
      });
      expect(audit.metadata).toMatchObject({
        fromTermId,
        sectionsCreated: 3,
        graduated: 1,
        held: 1,
      });
      expect(JSON.stringify(audit.metadata)).not.toMatch(/@|Student|Teacher/);
    });

    it('re-execution and re-editing are refused; nothing duplicates', async () => {
      const again = await http
        .post(`/api/v1/terms/${toTermId}/rollover/execute`)
        .set(auth(adminToken))
        .send({ confirmLabel: `RO-Spring-${sfx}` });
      expect(again.status).toBe(409);
      expect(
        (
          await http
            .patch(`/api/v1/terms/${toTermId}/rollover`)
            .set(auth(adminToken))
            .send({ sections: [] })
        ).status,
      ).toBe(409);
      expect(await prisma.section.count({ where: { termId: toTermId } })).toBe(3);
      expect(
        await prisma.enrollment.count({ where: { section: { termId: toTermId } } }),
      ).toBe(3);
      // Graduation not applied twice (still GRADUATED, count in counters fixed).
      const rollover = await prisma.termRollover.findFirstOrThrow({ where: { toTermId } });
      expect((rollover.counters as any).graduated).toBe(1);
    });
  });

  describe('failure atomicity & concurrency', () => {
    it('a mid-transaction failure leaves ZERO partial rollover state; retry then succeeds', async () => {
      // Fresh draft into the summer term with two entries; the SECOND
      // entry's MAP course is deleted after validation, so execution
      // fails after entry 1 already created a section inside the tx.
      const draft = await http
        .post(`/api/v1/terms/${toTerm2Id}/rollover`)
        .set(auth(adminToken))
        .send({ fromTermId });
      expect(draft.status).toBe(201);
      const plan = {
        sections: [
          {
            sourceSectionId: secA,
            action: 'CLONE',
            targetName: 'S-A',
            graduateStudents: false,
            carryTeachers: false,
            students: [],
          },
          {
            sourceSectionId: secB,
            action: 'MAP',
            targetCourseId: courseCId,
            targetName: 'S-B',
            graduateStudents: false,
            carryTeachers: false,
            students: [],
          },
        ],
      };
      expect(
        (
          await http
            .patch(`/api/v1/terms/${toTerm2Id}/rollover`)
            .set(auth(adminToken))
            .send(plan)
        ).status,
      ).toBe(200);

      // Sabotage: the MAP target course disappears before execution.
      await prisma.course.delete({ where: { id: courseCId } });
      const failed = await http
        .post(`/api/v1/terms/${toTerm2Id}/rollover/execute`)
        .set(auth(adminToken))
        .send({ confirmLabel: `RO-Summer-${sfx}` });
      expect(failed.status).toBe(400); // INVALID_COURSE mid-tx

      // ZERO partial state: no sections, no enrollments, rollover DRAFT.
      expect(await prisma.section.count({ where: { termId: toTerm2Id } })).toBe(0);
      expect(
        await prisma.enrollment.count({ where: { section: { termId: toTerm2Id } } }),
      ).toBe(0);
      const rollover = await prisma.termRollover.findFirstOrThrow({
        where: { toTermId: toTerm2Id },
      });
      expect(rollover.status).toBe('DRAFT');
      expect(rollover.executedAt).toBeNull();

      // Repair the plan (drop the broken entry) → clean retry succeeds.
      expect(
        (
          await http
            .patch(`/api/v1/terms/${toTerm2Id}/rollover`)
            .set(auth(adminToken))
            .send({ sections: [plan.sections[0]] })
        ).status,
      ).toBe(200);
      const retry = await http
        .post(`/api/v1/terms/${toTerm2Id}/rollover/execute`)
        .set(auth(adminToken))
        .send({ confirmLabel: `RO-Summer-${sfx}` });
      expect(retry.status).toBe(201);
      expect(await prisma.section.count({ where: { termId: toTerm2Id } })).toBe(1);
    });

    it('CONCURRENT execution attempts: exactly one succeeds', async () => {
      // Fresh isolated pair for the race.
      const year = await prisma.academicYear.findFirstOrThrow({
        where: { label: `RO-AY-${sfx}` },
      });
      const raceTo = await prisma.term.create({
        data: {
          collegeId,
          academicYearId: year.id,
          label: `RO-Race-${sfx}`,
          startsOn: new Date('2031-07-01'),
          endsOn: new Date('2031-07-28'),
        },
      });
      await http
        .post(`/api/v1/terms/${raceTo.id}/rollover`)
        .set(auth(adminToken))
        .send({ fromTermId });
      const results = await Promise.all([
        http
          .post(`/api/v1/terms/${raceTo.id}/rollover/execute`)
          .set(auth(adminToken))
          .send({ confirmLabel: `RO-Race-${sfx}` }),
        http
          .post(`/api/v1/terms/${raceTo.id}/rollover/execute`)
          .set(auth(adminToken))
          .send({ confirmLabel: `RO-Race-${sfx}` }),
      ]);
      const codes = results.map((r) => r.status).sort();
      expect(codes).toEqual([201, 409]);
      // Sections created exactly once (4 source sections, all default CLONE
      // minus none — suggested plan carries all 4).
      expect(await prisma.section.count({ where: { termId: raceTo.id } })).toBe(4);
      // Cleanup the race fixture rows (kept out of afterAll's term list).
      await prisma.enrollment.deleteMany({ where: { section: { termId: raceTo.id } } });
      await prisma.teachingAssignment.deleteMany({
        where: { section: { termId: raceTo.id } },
      });
      await prisma.termRollover.deleteMany({ where: { toTermId: raceTo.id } });
      await prisma.section.deleteMany({ where: { termId: raceTo.id } });
      await prisma.term.delete({ where: { id: raceTo.id } });
    });
  });
});
