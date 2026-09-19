import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M24-W3a — N-3 Batch 2: term-guard transaction boundaries, 10 sites.
 *
 * FINDING (N-3), continued from Batch 1. `assertTermOpen` /
 * `assertSectionTermOpen` take the Prisma client as their first argument and
 * lock the Term row `FOR SHARE`, which is what serializes a write against
 * `close()`'s `FOR UPDATE`. That lock lives only as long as the enclosing
 * transaction, so every caller passing `this.prisma` ran the guard in its own
 * implicit single-statement transaction — committing, and releasing the lock,
 * before the guard even returned. A term could therefore commit CLOSED in the
 * window between the assertion and the write.
 *
 * Batch 2 sites:
 *   #3  academics/sections.service.ts    create
 *   #6  academics/sections.service.ts    unenroll
 *   #8  academics/sections.service.ts    unassignTeacher
 *   #9  assignments/assignments.service.ts create
 *   #11 assignments/assignments.service.ts remove
 *   #12 assignments/assignments.service.ts publish
 *   #15 attendance/attendance.service.ts  updateSession
 *   #17 exams/exams.service.ts            create
 *   #20 exams/exams.service.ts            createPaper
 *   #26 timetable/timetable.service.ts    deleteSlot
 *
 * Two shapes were used, chosen per site by what sits between the old guard
 * and the write:
 *
 *   PURE MOVE (#9, #17, #26) — nothing was validated in between, so the
 *   guard simply moved onto `tx`; no preflight is needed and no error
 *   precedence changes.
 *
 *   DUAL preflight + authoritative in-transaction re-assert (#3, #6, #8,
 *   #11, #12, #15, #20) — validation DOES sit in between, so moving the
 *   guard would have reordered established errors (DUPLICATE_SECTION_NAME,
 *   'Enrollment not found', 'Teaching assignment not found',
 *   HAS_SUBMISSIONS, ALREADY_PUBLISHED, SESSION_HAS_ATTENDANCE,
 *   EXAM_PUBLISHED / INVALID_SECTION / TERM_MISMATCH / DUPLICATE_PAPER).
 *   The preflight is retained for precedence and the AUTHORITATIVE assertion
 *   is the first statement inside the mutating transaction — the pattern
 *   already established by `fees.generateInvoices`.
 *
 * Coverage: (A) closed term rejects and the database is unchanged; (B) open
 * term succeeds and the database really changed; (C) a live close/mutate
 * race upholds the invariant; (D) a per-site DISCRIMINATOR proving the guard
 * holds the Term lock across the mutation — group D fails against the
 * pre-fix source, which is what makes it meaningful.
 */
describe('M24-W3a — N-3 Batch 2: guard inside the mutating transaction', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let adminToken: string;
  let yearId: string;
  let courseId: string;
  let studentProfileId: string;
  let teacherProfileId: string;
  let adminUserId: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  interface Fixture {
    termId: string;
    termLabel: string;
    sectionId: string;
    examId: string;
    paperId: string;
    assignmentId: string;
    publishedAssignmentId: string;
    slotId: string;
    sessionId: string;
    enrollmentId: string;
    teachingId: string;
    newSectionName: string;
  }

  const closeTerm = (id: string, label: string) =>
    http
      .post(`/api/v1/terms/${id}/close`)
      .set(auth(adminToken))
      .send({ confirmLabel: label });

  function expectClosed(res: request.Response) {
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TERM_CLOSED');
  }

  let seq = 0;
  async function freshFixture(tag: string): Promise<Fixture> {
    const label = `W3AB2-${suffix}-${tag}-${(seq += 1)}`;
    const term = await prisma.term.create({
      data: {
        collegeId,
        academicYearId: yearId,
        label,
        startsOn: new Date('2030-01-01'),
        endsOn: new Date('2030-06-30'),
      },
    });
    const section = await prisma.section.create({
      data: { collegeId, courseId, termId: term.id, name: `S${seq}`, capacity: 30 },
    });
    const exam = await prisma.exam.create({
      data: { collegeId, termId: term.id, title: `${label}-exam`, type: 'MIDTERM' },
    });
    // A second section carries the pre-existing paper, leaving `section`
    // free for the createPaper (#20) scenario.
    const paperSection = await prisma.section.create({
      data: { collegeId, courseId, termId: term.id, name: `P${seq}`, capacity: 10 },
    });
    const paper = await prisma.examPaper.create({
      data: {
        examId: exam.id,
        sectionId: paperSection.id,
        maxMarks: 100,
        examDate: new Date('2030-03-01'),
      },
    });
    const assignment = await prisma.assignment.create({
      data: {
        sectionId: section.id,
        title: `${label}-a1`,
        description: 'x',
        dueAt: new Date('2030-04-01'),
        maxPoints: 10,
        allowLate: true,
        createdById: adminUserId,
      },
    });
    const publishedAssignment = await prisma.assignment.create({
      data: {
        sectionId: section.id,
        title: `${label}-a2`,
        description: 'x',
        dueAt: new Date('2030-04-02'),
        maxPoints: 10,
        allowLate: true,
        createdById: adminUserId,
      },
    });
    const slot = await prisma.timetableSlot.create({
      data: {
        sectionId: section.id,
        dayOfWeek: 2,
        startTime: '11:00',
        endTime: '12:00',
        room: `${tag}-R`,
      },
    });
    // The session hangs off a SECOND slot so deleting `slot` (#26) is not
    // blocked by SLOT_HAS_SESSIONS.
    const sessionSlot = await prisma.timetableSlot.create({
      data: { sectionId: section.id, dayOfWeek: 4, startTime: '09:00', endTime: '10:00' },
    });
    const session = await prisma.classSession.create({
      data: { slotId: sessionSlot.id, sectionId: section.id, date: new Date('2030-02-07') },
    });
    const enrollment = await prisma.enrollment.create({
      data: { sectionId: section.id, studentId: studentProfileId },
    });
    const teaching = await prisma.teachingAssignment.create({
      data: { sectionId: section.id, teacherId: teacherProfileId },
    });
    return {
      termId: term.id,
      termLabel: label,
      sectionId: section.id,
      examId: exam.id,
      paperId: paper.id,
      assignmentId: assignment.id,
      publishedAssignmentId: publishedAssignment.id,
      slotId: slot.id,
      sessionId: session.id,
      enrollmentId: enrollment.id,
      teachingId: teaching.id,
      newSectionName: `NEW${seq}`,
    };
  }

  async function dropFixture(f: Fixture) {
    await prisma.attendanceRecord.deleteMany({ where: { session: { sectionId: f.sectionId } } });
    await prisma.classSession.deleteMany({ where: { section: { termId: f.termId } } });
    await prisma.timetableSlot.deleteMany({ where: { section: { termId: f.termId } } });
    await prisma.submission.deleteMany({ where: { assignment: { section: { termId: f.termId } } } });
    await prisma.assignment.deleteMany({ where: { section: { termId: f.termId } } });
    await prisma.mark.deleteMany({ where: { examPaper: { examId: f.examId } } });
    await prisma.examPaper.deleteMany({ where: { examId: f.examId } });
    await prisma.exam.deleteMany({ where: { termId: f.termId } });
    await prisma.enrollment.deleteMany({ where: { section: { termId: f.termId } } });
    await prisma.teachingAssignment.deleteMany({ where: { section: { termId: f.termId } } });
    await prisma.section.deleteMany({ where: { termId: f.termId } });
    await prisma.term.deleteMany({ where: { id: f.termId } });
  }

  /**
   * Park strategy: a lock, held in a rolled-back transaction, that blocks the
   * site's MUTATION statement while letting all of its preceding validation
   * reads through. Row `FOR UPDATE` is used for UPDATE/DELETE sites (plain
   * SELECTs are never blocked by it under READ COMMITTED); an
   * ACCESS EXCLUSIVE table lock is used for the two CREATE sites whose target
   * table is not read beforehand; and a conflicting uncommitted INSERT is
   * used for the two CREATE sites that DO probe their target table first
   * (the probe passes — it cannot see the uncommitted row — and the INSERT
   * then blocks on the unique index).
   */
  type Park = (tx: PrismaService, f: Fixture) => Promise<void>;

  const rowLock =
    (table: string, pick: (f: Fixture) => string): Park =>
    async (tx, f) => {
      await (tx as unknown as {
        $queryRawUnsafe(q: string, ...a: unknown[]): Promise<unknown>;
      }).$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`, pick(f));
    };

  const tableLock =
    (table: string): Park =>
    async (tx) => {
      // EXCLUSIVE (not ACCESS EXCLUSIVE): conflicts with the ROW EXCLUSIVE
      // an INSERT needs, but NOT with the ACCESS SHARE a plain SELECT needs.
      // So a site's duplicate/validation probe still reads through, and only
      // the INSERT parks. Crucially it takes no lock on Term — an earlier
      // attempt parked #3 with a conflicting uncommitted INSERT instead, and
      // that row's foreign key took a KEY SHARE lock on the Term row, so the
      // PARKER (not the request) blocked the probe and the discriminator
      // passed even against the vulnerable source. A table-level lock cannot
      // contaminate the Term row that way.
      await (tx as unknown as {
        $executeRawUnsafe(q: string): Promise<unknown>;
      }).$executeRawUnsafe(`LOCK TABLE "${table}" IN EXCLUSIVE MODE`);
    };

  interface Scenario {
    site: string;
    name: string;
    /** Mutation that must be refused while the term is closed. */
    mutate: (f: Fixture) => Promise<request.Response>;
    /** Direct database observation of the protected state. */
    state: (f: Fixture) => Promise<string>;
    /** Expected `state` once the mutation has succeeded. */
    done: string;
    okStatus: number;
    park: Park;
  }

  const scenarios: Scenario[] = [
    {
      site: '#3',
      name: 'sections.create — POST /sections',
      mutate: (f) =>
        http.post('/api/v1/sections').set(auth(adminToken)).send({
          courseId,
          termId: f.termId,
          name: f.newSectionName,
          capacity: 20,
        }),
      state: async (f) =>
        String(
          await prisma.section.count({
            where: { courseId, termId: f.termId, name: f.newSectionName },
          }),
        ),
      done: '1',
      okStatus: 201,
      // Section is probed for duplicates first; EXCLUSIVE mode lets that
      // SELECT through and parks only the INSERT, without locking Term.
      park: tableLock('Section'),
    },
    {
      site: '#6',
      name: 'sections.unenroll — DELETE /sections/:id/enrollments/:studentId',
      mutate: (f) =>
        http
          .delete(`/api/v1/sections/${f.sectionId}/enrollments/${studentProfileId}`)
          .set(auth(adminToken)),
      state: async (f) =>
        (
          await prisma.enrollment.findUniqueOrThrow({
            where: { id: f.enrollmentId },
            select: { status: true },
          })
        ).status,
      done: 'DROPPED',
      okStatus: 200,
      park: rowLock('Enrollment', (f) => f.enrollmentId),
    },
    {
      site: '#8',
      name: 'sections.unassignTeacher — DELETE /sections/:id/teachers/:teacherId',
      mutate: (f) =>
        http
          .delete(`/api/v1/sections/${f.sectionId}/teachers/${teacherProfileId}`)
          .set(auth(adminToken)),
      state: async (f) =>
        String(await prisma.teachingAssignment.count({ where: { id: f.teachingId } })),
      done: '0',
      okStatus: 200,
      park: rowLock('TeachingAssignment', (f) => f.teachingId),
    },
    {
      site: '#9',
      name: 'assignments.create — POST /assignments',
      mutate: (f) =>
        http.post('/api/v1/assignments').set(auth(adminToken)).send({
          sectionId: f.sectionId,
          title: `${f.termLabel}-new`,
          description: 'y',
          dueAt: '2030-05-01T10:00:00.000Z',
          maxPoints: 20,
          allowLate: false,
        }),
      state: async (f) =>
        String(
          await prisma.assignment.count({
            where: { sectionId: f.sectionId, title: `${f.termLabel}-new` },
          }),
        ),
      done: '1',
      okStatus: 201,
      // Assignment is not read before the insert; EXCLUSIVE mode parks the
      // insert itself.
      park: tableLock('Assignment'),
    },
    {
      site: '#11',
      name: 'assignments.remove — DELETE /assignments/:id',
      mutate: (f) =>
        http.delete(`/api/v1/assignments/${f.assignmentId}`).set(auth(adminToken)),
      state: async (f) =>
        String(await prisma.assignment.count({ where: { id: f.assignmentId } })),
      done: '0',
      okStatus: 200,
      park: rowLock('Assignment', (f) => f.assignmentId),
    },
    {
      site: '#12',
      name: 'assignments.publish — POST /assignments/:id/publish',
      mutate: (f) =>
        http
          .post(`/api/v1/assignments/${f.publishedAssignmentId}/publish`)
          .set(auth(adminToken))
          .send({}),
      state: async (f) =>
        (
          await prisma.assignment.findUniqueOrThrow({
            where: { id: f.publishedAssignmentId },
            select: { publishedAt: true },
          })
        ).publishedAt === null
          ? 'unpublished'
          : 'published',
      done: 'published',
      okStatus: 201,
      park: rowLock('Assignment', (f) => f.publishedAssignmentId),
    },
    {
      site: '#15',
      name: 'attendance.updateSession — PATCH /sessions/:id',
      mutate: (f) =>
        http
          .patch(`/api/v1/sessions/${f.sessionId}`)
          .set(auth(adminToken))
          .send({ status: 'CANCELLED', note: 'n3b2' }),
      state: async (f) =>
        (
          await prisma.classSession.findUniqueOrThrow({
            where: { id: f.sessionId },
            select: { status: true },
          })
        ).status,
      done: 'CANCELLED',
      okStatus: 200,
      park: rowLock('ClassSession', (f) => f.sessionId),
    },
    {
      site: '#17',
      name: 'exams.create — POST /exams',
      mutate: (f) =>
        http
          .post('/api/v1/exams')
          .set(auth(adminToken))
          .send({ termId: f.termId, title: `${f.termLabel}-new-exam`, type: 'FINAL' }),
      state: async (f) =>
        String(
          await prisma.exam.count({
            where: { termId: f.termId, title: `${f.termLabel}-new-exam` },
          }),
        ),
      done: '1',
      okStatus: 201,
      // Exam is not read before the insert (only Term is); EXCLUSIVE mode
      // parks the insert itself.
      park: tableLock('Exam'),
    },
    {
      site: '#20',
      name: 'exams.createPaper — POST /exams/:id/papers',
      mutate: (f) =>
        http
          .post(`/api/v1/exams/${f.examId}/papers`)
          .set(auth(adminToken))
          .send({
            sectionId: f.sectionId,
            maxMarks: 50,
            examDate: '2030-03-15T09:00:00.000Z',
          }),
      state: async (f) =>
        String(
          await prisma.examPaper.count({
            where: { examId: f.examId, sectionId: f.sectionId },
          }),
        ),
      done: '1',
      okStatus: 201,
      // ExamPaper is probed for duplicates first; EXCLUSIVE mode lets that
      // SELECT through and parks only the INSERT, without locking Term.
      park: tableLock('ExamPaper'),
    },
    {
      site: '#26',
      name: 'timetable.deleteSlot — DELETE /timetable/slots/:id',
      mutate: (f) =>
        http.delete(`/api/v1/timetable/slots/${f.slotId}`).set(auth(adminToken)),
      state: async (f) =>
        String(await prisma.timetableSlot.count({ where: { id: f.slotId } })),
      done: '0',
      okStatus: 200,
      park: rowLock('TimetableSlot', (f) => f.slotId),
    },
  ];

  const cases = scenarios.map((s) => [s.site, s.name, s] as const);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
    adminUserId = admin.id;
    const student = await prisma.user.findFirstOrThrow({
      where: { email: 'student@campusos.dev' },
      include: { studentProfile: true },
    });
    studentProfileId = student.studentProfile!.id;
    const teacher = await prisma.user.findFirstOrThrow({
      where: { email: 'teacher@campusos.dev' },
      include: { teacherProfile: true },
    });
    teacherProfileId = teacher.teacherProfile!.id;

    yearId = (
      await prisma.academicYear.create({
        data: {
          collegeId,
          label: `W3AB2-AY-${suffix}`,
          startsOn: new Date('2030-01-01'),
          endsOn: new Date('2030-12-31'),
        },
      })
    ).id;
    const department = await prisma.department.findFirstOrThrow({ where: { collegeId } });
    courseId = (
      await prisma.course.create({
        data: {
          collegeId,
          departmentId: department.id,
          code: `W3B2-${suffix}`.slice(0, 12),
          title: 'N-3 Batch 2 Course',
          credits: 3,
        },
      })
    ).id;

    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email: 'admin@campusos.dev', password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    adminToken = res.body.data.accessToken as string;
  });

  afterAll(async () => {
    const terms = await prisma.term.findMany({
      where: { academicYearId: yearId },
      select: { id: true },
    });
    for (const t of terms) {
      await dropFixture({ termId: t.id, examId: '', sectionId: '' } as Fixture);
    }
    await prisma.course.deleteMany({ where: { id: courseId } });
    await prisma.term.deleteMany({ where: { academicYearId: yearId } });
    await prisma.academicYear.deleteMany({ where: { id: yearId } });
    await app.close();
  });

  describe('A. a CLOSED term refuses the mutation and the database is unchanged', () => {
    it.each(cases)('%s %s', async (_s, _n, sc) => {
      const f = await freshFixture('A');
      try {
        const before = await sc.state(f);
        expect((await closeTerm(f.termId, f.termLabel)).status).toBe(201);
        expectClosed(await sc.mutate(f));
        expect(await sc.state(f)).toBe(before);
        expect(await sc.state(f)).not.toBe(sc.done);
      } finally {
        await dropFixture(f);
      }
    }, 60_000);
  });

  describe('B. an OPEN term permits the mutation and the database really changed', () => {
    it.each(cases)('%s %s', async (_s, _n, sc) => {
      const f = await freshFixture('B');
      try {
        const res = await sc.mutate(f);
        expect(res.status).toBe(sc.okStatus);
        expect(await sc.state(f)).toBe(sc.done);
      } finally {
        await dropFixture(f);
      }
    }, 60_000);
  });

  describe('C. close racing the mutation upholds the invariant (real Postgres)', () => {
    it.each(cases)('%s %s', async (_s, _n, sc) => {
      for (let round = 0; round < 3; round += 1) {
        const f = await freshFixture(`C${round}`);
        try {
          const before = await sc.state(f);
          const [close, mutation] = await Promise.all([
            closeTerm(f.termId, f.termLabel),
            sc.mutate(f),
          ]);
          expect(close.status).toBe(201);
          const now = await sc.state(f);
          if (mutation.status === sc.okStatus) {
            // Committed while the term was still open, holding FOR SHARE.
            expect(now).toBe(sc.done);
          } else {
            // Refused — and NOTHING moved. Never "200 + closed + committed".
            expectClosed(mutation);
            expect(now).toBe(before);
          }
        } finally {
          await dropFixture(f);
        }
      }
    }, 120_000);
  });

  /**
   * D. DISCRIMINATOR — the group that actually fails without the fix.
   *
   * The request is parked on its own mutation statement, i.e. after all of
   * its validation and INSIDE the mutating transaction. While it is parked a
   * separate connection probes the Term row with `FOR UPDATE`, which is the
   * first thing `close()` does.
   *
   *   FIXED  — the authoritative assertion ran on `tx` and still holds
   *            `FOR SHARE`, so the probe cannot acquire and times out.
   *   PRE-FIX — the guard ran on `this.prisma` and released its lock before
   *            returning, so the probe acquires immediately: a close could
   *            commit here and the write would land in a closed term.
   *
   * Asserting that the probe is BLOCKED therefore passes only for the fixed
   * source. Real Postgres locks; no mocks.
   */
  describe('D. the authoritative guard holds the Term lock across the mutation', () => {
    it.each(cases)('%s %s', async (_s, _n, sc) => {
      const f = await freshFixture('D');
      let release!: () => void;
      const held = new Promise<void>((r) => {
        release = r;
      });
      class Rollback extends Error {}

      const parker = prisma
        .$transaction(
          async (tx) => {
            await sc.park(tx as unknown as PrismaService, f);
            await held;
            throw new Rollback();
          },
          { timeout: 120_000, maxWait: 30_000 },
        )
        .catch((e) => {
          if (!(e instanceof Rollback)) throw e;
        });

      let probeBlocked: boolean | null = null;
      let mutation: request.Response | undefined;
      try {
        await settle();
        // supertest requests are lazy — they are only dispatched when `then`
        // is called, so the await inside this IIFE is what actually sends it.
        const inFlight = (async () => await sc.mutate(f))();
        // Wait until the request is parked on its mutation statement.
        await waitFor(async () => {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND state = 'active'`;
          return Number(rows[0].n) > 0;
        }, `${sc.site} to park on its mutation`);

        probeBlocked = await termLockBlocked(f.termId);

        release();
        await parker;
        mutation = await inFlight;
      } finally {
        release();
        await parker.catch(() => undefined);
      }

      // The crux of N-3.
      expect(probeBlocked).toBe(true);

      // The mutation itself still completed correctly against the open term.
      expect(mutation!.status).toBe(sc.okStatus);
      expect(await sc.state(f)).toBe(sc.done);

      await dropFixture(f);
    }, 120_000);
  });

  /** True when a close's `FOR UPDATE` on the Term row cannot be acquired. */
  async function termLockBlocked(termId: string): Promise<boolean> {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SET LOCAL lock_timeout = '2s'`;
        await tx.$queryRawUnsafe(
          `SELECT "status" FROM "Term" WHERE id = $1 FOR UPDATE`,
          termId,
        );
      });
      return false;
    } catch {
      return true;
    }
  }

  async function waitFor(
    probe: () => Promise<boolean>,
    what: string,
    timeoutMs = 20_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await probe()) return;
      await settle(50);
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  function settle(ms = 200): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
});
