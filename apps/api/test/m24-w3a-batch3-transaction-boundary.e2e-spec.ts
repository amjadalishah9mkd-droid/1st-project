import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M24-W3a — N-3 Batch 3: batch → interactive transaction conversion.
 *
 * FINDING (N-3), continued. `assertTermOpen` / `assertSectionTermOpen` take
 * the Prisma client as their first argument and lock the Term row
 * `FOR SHARE`, which is what serializes a write against `close()`'s
 * `FOR UPDATE`. That lock lives only as long as the enclosing transaction.
 *
 * Batch 3 is the subset whose transaction used the ARRAY form,
 * `$transaction([...])`. Its elements are pre-built promises created off
 * `this.prisma`, so the guard — an `async` call — could not be an element
 * and had nowhere to run inside the transaction at all. These four sites
 * were therefore converted to the interactive form so the authoritative
 * assertion and every dependent write share one transaction:
 *
 *   #7  academics/sections.service.ts   assignTeacher
 *         teachingAssignment.updateMany + teachingAssignment.create
 *   #16 attendance/attendance.service.ts saveAttendance
 *         N × attendanceRecord.upsert + classSession.update  (highest risk)
 *   #19 exams/exams.service.ts           publish
 *         exam.update + mark.updateMany
 *   #22 exams/exams.service.ts           saveMarks
 *         N × mark.upsert
 *
 * Statement order is preserved by awaiting sequentially, which is what the
 * array form did. Each site retains its pre-existing preflight assertion so
 * established error precedence is unchanged (TERM_CLOSED before
 * INVALID_TEACHER / ALREADY_ASSIGNED, NOT_ENROLLED, ALREADY_PUBLISHED /
 * NO_PAPERS, and MARKS_LOCKED / MARKS_EXCEED_MAX respectively); the
 * preflight does NOT replace the in-transaction guard. `audit.log` stays
 * fire-and-forget outside the transaction and no `logAtomic` was
 * introduced. Events remain post-commit.
 *
 * Coverage: (A) closed term rejects, database unchanged; (B) open term
 * succeeds, database changed; (C) live close/mutate race; (D) per-site
 * DISCRIMINATOR proving the lifecycle lock is still held while the mutation
 * executes — group D fails against the pre-fix source.
 */
describe('M24-W3a — N-3 Batch 3: batch → interactive transaction', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let adminToken: string;
  let adminUserId: string;
  let yearId: string;
  let courseId: string;
  let studentProfileId: string;
  let teacherProfileId: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  interface Fixture {
    termId: string;
    termLabel: string;
    sectionId: string;
    examId: string;
    paperId: string;
    sessionId: string;
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
    const label = `W3AB3-${suffix}-${tag}-${(seq += 1)}`;
    const term = await prisma.term.create({
      data: {
        collegeId,
        academicYearId: yearId,
        label,
        startsOn: new Date('2031-01-01'),
        endsOn: new Date('2031-06-30'),
      },
    });
    const section = await prisma.section.create({
      data: { collegeId, courseId, termId: term.id, name: `S${seq}`, capacity: 30 },
    });
    await prisma.enrollment.create({
      data: { sectionId: section.id, studentId: studentProfileId },
    });
    const exam = await prisma.exam.create({
      data: { collegeId, termId: term.id, title: `${label}-exam`, type: 'MIDTERM' },
    });
    // publish (#19) requires at least one paper (NO_PAPERS).
    const paper = await prisma.examPaper.create({
      data: {
        examId: exam.id,
        sectionId: section.id,
        maxMarks: 100,
        examDate: new Date('2031-03-01'),
      },
    });
    // An existing unlocked mark so publish's mark.updateMany has a row.
    await prisma.mark.create({
      data: {
        examPaperId: paper.id,
        studentId: studentProfileId,
        marksObtained: 40,
        enteredById: adminUserId,
      },
    });
    const slot = await prisma.timetableSlot.create({
      data: { sectionId: section.id, dayOfWeek: 3, startTime: '10:00', endTime: '11:00' },
    });
    const session = await prisma.classSession.create({
      data: { slotId: slot.id, sectionId: section.id, date: new Date('2031-02-05') },
    });
    // NOTE: deliberately NO teachingAssignment — assignTeacher (#7) creates it.
    return {
      termId: term.id,
      termLabel: label,
      sectionId: section.id,
      examId: exam.id,
      paperId: paper.id,
      sessionId: session.id,
    };
  }

  async function dropFixture(f: Fixture) {
    await prisma.attendanceRecord.deleteMany({
      where: { session: { section: { termId: f.termId } } },
    });
    await prisma.classSession.deleteMany({ where: { section: { termId: f.termId } } });
    await prisma.timetableSlot.deleteMany({ where: { section: { termId: f.termId } } });
    await prisma.mark.deleteMany({ where: { examPaper: { exam: { termId: f.termId } } } });
    await prisma.examPaper.deleteMany({ where: { exam: { termId: f.termId } } });
    await prisma.exam.deleteMany({ where: { termId: f.termId } });
    await prisma.enrollment.deleteMany({ where: { section: { termId: f.termId } } });
    await prisma.teachingAssignment.deleteMany({
      where: { section: { termId: f.termId } },
    });
    await prisma.section.deleteMany({ where: { termId: f.termId } });
    await prisma.term.deleteMany({ where: { id: f.termId } });
  }

  /**
   * Park strategy — `LOCK TABLE <t> IN EXCLUSIVE MODE`, held in a
   * rolled-back transaction. EXCLUSIVE conflicts with the ROW EXCLUSIVE that
   * INSERT/UPDATE/DELETE need, but NOT with the ACCESS SHARE a plain SELECT
   * needs. So each site's preceding validation reads (including reads of the
   * very same table, e.g. assignTeacher's ALREADY_ASSIGNED probe and
   * saveAttendance's previous-status read) pass straight through, and the
   * request parks exactly on its first MUTATION — which is inside the new
   * transaction. A table-level lock also cannot touch the Term row, so the
   * parker can never contaminate the probe.
   */
  const tableLock =
    (table: string) =>
    async (tx: PrismaService): Promise<void> => {
      await (tx as unknown as {
        $executeRawUnsafe(q: string): Promise<unknown>;
      }).$executeRawUnsafe(`LOCK TABLE "${table}" IN EXCLUSIVE MODE`);
    };

  interface Scenario {
    site: string;
    name: string;
    mutate: (f: Fixture) => Promise<request.Response>;
    /** Direct database observation of the protected state. */
    state: (f: Fixture) => Promise<string>;
    done: string;
    okStatus: number;
    park: (tx: PrismaService) => Promise<void>;
  }

  const scenarios: Scenario[] = [
    {
      site: '#7',
      name: 'sections.assignTeacher — POST /sections/:id/teachers/:teacherId',
      mutate: (f) =>
        http
          .post(`/api/v1/sections/${f.sectionId}/teachers/${teacherProfileId}`)
          .set(auth(adminToken))
          .send({ isPrimary: true }),
      state: async (f) =>
        String(
          await prisma.teachingAssignment.count({
            where: { sectionId: f.sectionId, teacherId: teacherProfileId },
          }),
        ),
      done: '1',
      okStatus: 201,
      park: tableLock('TeachingAssignment'),
    },
    {
      site: '#16',
      name: 'attendance.saveAttendance — PUT /sessions/:id/attendance',
      mutate: (f) =>
        http
          .put(`/api/v1/sessions/${f.sessionId}/attendance`)
          .set(auth(adminToken))
          .send({ records: [{ studentId: studentProfileId, status: 'ABSENT' }] }),
      // Both halves of the atomic save: the record AND the HELD transition.
      state: async (f) => {
        const recs = await prisma.attendanceRecord.count({
          where: { sessionId: f.sessionId },
        });
        const s = await prisma.classSession.findUniqueOrThrow({
          where: { id: f.sessionId },
          select: { status: true },
        });
        return `${recs}/${s.status}`;
      },
      done: '1/HELD',
      okStatus: 200,
      park: tableLock('AttendanceRecord'),
    },
    {
      site: '#19',
      name: 'exams.publish — POST /exams/:id/publish',
      mutate: (f) =>
        http.post(`/api/v1/exams/${f.examId}/publish`).set(auth(adminToken)).send({}),
      // Both halves: the exam transition AND the mark locking.
      state: async (f) => {
        const e = await prisma.exam.findUniqueOrThrow({
          where: { id: f.examId },
          select: { status: true },
        });
        const locked = await prisma.mark.count({
          where: { examPaper: { examId: f.examId }, lockedAt: { not: null } },
        });
        return `${e.status}/${locked}`;
      },
      done: 'PUBLISHED/1',
      okStatus: 201,
      park: tableLock('Exam'),
    },
    {
      site: '#22',
      name: 'exams.saveMarks — PUT /papers/:id/marks',
      mutate: (f) =>
        http
          .put(`/api/v1/papers/${f.paperId}/marks`)
          .set(auth(adminToken))
          .send({ marks: [{ studentId: studentProfileId, marksObtained: 88 }] }),
      state: async (f) =>
        String(
          (
            await prisma.mark.findFirstOrThrow({
              where: { examPaperId: f.paperId, studentId: studentProfileId },
              select: { marksObtained: true },
            })
          ).marksObtained,
        ),
      done: '88',
      okStatus: 200,
      park: tableLock('Mark'),
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
          label: `W3AB3-AY-${suffix}`,
          startsOn: new Date('2031-01-01'),
          endsOn: new Date('2031-12-31'),
        },
      })
    ).id;
    const department = await prisma.department.findFirstOrThrow({ where: { collegeId } });
    courseId = (
      await prisma.course.create({
        data: {
          collegeId,
          departmentId: department.id,
          code: `W3B3-${suffix}`.slice(0, 12),
          title: 'N-3 Batch 3 Course',
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
    for (const t of terms) await dropFixture({ termId: t.id } as Fixture);
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

  describe('B. an OPEN term permits the mutation and every dependent write landed', () => {
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
            // Refused, and NOTHING moved — never a partial write either,
            // which is what the interactive conversion also buys.
            expectClosed(mutation);
            expect(now).toBe(before);
          }
        } finally {
          await dropFixture(f);
        }
      }
    }, 180_000);
  });

  /**
   * D. DISCRIMINATOR — proves the lifecycle lock is HELD while the mutation
   * executes, which is exactly what the array form could not do.
   *
   * The request is parked on its first mutation statement, i.e. after all of
   * its validation and inside the new transaction. A separate connection then
   * probes the Term row with `FOR UPDATE` — the first thing `close()` does.
   *
   *   FIXED   — the authoritative assertion ran on `tx` and still holds
   *             FOR SHARE, so the probe cannot acquire and times out.
   *   PRE-FIX — no assertion ran inside the transaction at all, so the probe
   *             acquires immediately: a close could commit right here and the
   *             batch would land in a closed term.
   */
  describe('D. the lifecycle lock is held while the mutation executes', () => {
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
            await sc.park(tx as unknown as PrismaService);
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
        // supertest requests are lazy — the await inside this IIFE is what
        // actually dispatches it.
        const inFlight = (async () => await sc.mutate(f))();
        await waitFor(async () => {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM pg_locks WHERE NOT granted`;
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

      // The crux of N-3 for the batch-form sites.
      expect(probeBlocked).toBe(true);

      // And the operation still completed correctly against the open term.
      expect(mutation!.status).toBe(sc.okStatus);
      expect(await sc.state(f)).toBe(sc.done);

      await dropFixture(f);
    }, 180_000);
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
