import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M24-W3a — N-3 Batch 1: term-guard transaction boundaries (Pattern E).
 *
 * FINDING (N-3). `assertTermOpen` / `assertSectionTermOpen` take the Prisma
 * client as their FIRST argument and lock the Term row `FOR SHARE`, which
 * serializes against `close()`'s `FOR UPDATE`. That lock only exists for the
 * lifetime of the enclosing transaction. Every caller that passed
 * `this.prisma` therefore ran the guard in its own implicit single-statement
 * transaction, which COMMITS — and releases the lock — before the guard even
 * returns. The intended `FOR SHARE` ↔ `FOR UPDATE` serialization never
 * happened, so a term could commit CLOSED in the window between the guard
 * and the write, and the write would land in a closed term.
 *
 * Batch 1 covers the five sites that ALREADY owned an interactive
 * transaction, where the guard simply was not part of it:
 *
 *   #1  academics/calendar.service.ts   updateTerm
 *   #4  academics/sections.service.ts   update
 *   #18 exams/exams.service.ts          update
 *   #21 exams/exams.service.ts          updatePaper
 *   #25 timetable/timetable.service.ts  updateSlot
 *
 * FIX SHAPE. The pre-existing preflight assertion is retained (it is what
 * establishes the documented error precedence — TERM_CLOSED is reported
 * before INVALID_DATES / CAPACITY_BELOW_ENROLLMENT / EXAM_PUBLISHED /
 * SLOT_CONFLICT), and the AUTHORITATIVE assertion is re-issued as the first
 * statement inside the existing transaction, on `tx`. Guard and mutation now
 * share one transaction with no boundary between them. This is the same dual
 * preflight+re-assert pattern already established by
 * `fees.generateInvoices` (fees.service.ts) — no new abstraction, no new
 * transaction, no nesting, and `term-lifecycle.service.ts` is untouched.
 *
 * Coverage below, parameterized over all five paths:
 *   A. a CLOSED term rejects the mutation (409 TERM_CLOSED) and the row is
 *      byte-for-byte unchanged;
 *   B. an OPEN term permits the mutation and the row really changes;
 *   C. a REAL close/mutation race on live Postgres upholds the invariant —
 *      either the mutation committed and the row changed, or it was refused
 *      and the row is untouched. Never a write into a closed term.
 *
 * Plus a deterministic lock-semantics proof (no mocks) showing WHY the fix
 * works and that the old shape could not: a `FOR SHARE` taken on
 * `this.prisma` does not block a subsequent `FOR UPDATE`, while the same
 * `FOR SHARE` taken inside a transaction does.
 */
describe('M24-W3a — N-3 Batch 1: guard inside the mutating transaction', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let adminToken: string;
  let yearId: string;
  let courseId: string;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  interface Fixture {
    termId: string;
    termLabel: string;
    sectionId: string;
    examId: string;
    paperId: string;
    slotId: string;
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

  let fixtureSeq = 0;
  async function freshFixture(tag: string): Promise<Fixture> {
    const label = `W3A-${suffix}-${tag}-${(fixtureSeq += 1)}`;
    const term = await prisma.term.create({
      data: {
        collegeId,
        academicYearId: yearId,
        label,
        startsOn: new Date('2029-01-01'),
        endsOn: new Date('2029-06-30'),
      },
    });
    const section = await prisma.section.create({
      data: { collegeId, courseId, termId: term.id, name: 'A', capacity: 30 },
    });
    const exam = await prisma.exam.create({
      data: { collegeId, termId: term.id, title: `${label}-exam`, type: 'MIDTERM' },
    });
    const paper = await prisma.examPaper.create({
      data: {
        examId: exam.id,
        sectionId: section.id,
        maxMarks: 100,
        examDate: new Date('2029-03-01'),
        room: `${tag}-P0`,
      },
    });
    const slot = await prisma.timetableSlot.create({
      data: {
        sectionId: section.id,
        dayOfWeek: 2,
        startTime: '11:00',
        endTime: '12:00',
        room: `${tag}-S0`,
      },
    });
    return {
      termId: term.id,
      termLabel: label,
      sectionId: section.id,
      examId: exam.id,
      paperId: paper.id,
      slotId: slot.id,
    };
  }

  async function dropFixture(f: Fixture) {
    await prisma.examPaper.deleteMany({ where: { examId: f.examId } });
    await prisma.exam.deleteMany({ where: { id: f.examId } });
    await prisma.timetableSlot.deleteMany({ where: { sectionId: f.sectionId } });
    await prisma.section.deleteMany({ where: { id: f.sectionId } });
    await prisma.term.deleteMany({ where: { id: f.termId } });
  }

  /**
   * One scenario per Batch-1 call site. `mutate` issues the real HTTP
   * mutation; `read` returns the persisted value of the exact column that
   * mutation writes, so "the row did not change" is asserted against the
   * database rather than the response.
   */
  interface Scenario {
    site: string;
    name: string;
    mutate: (f: Fixture) => Promise<request.Response>;
    read: (f: Fixture) => Promise<string | null>;
    after: string;
  }

  const NEW = `W3A-${suffix}-NEW`;

  const scenarios: Scenario[] = [
    {
      site: '#1',
      name: 'calendar.updateTerm — PATCH /terms/:id',
      mutate: (f) =>
        http
          .patch(`/api/v1/terms/${f.termId}`)
          .set(auth(adminToken))
          .send({ endsOn: '2029-07-15' }),
      read: async (f) =>
        (
          await prisma.term.findUniqueOrThrow({
            where: { id: f.termId },
            select: { endsOn: true },
          })
        ).endsOn
          .toISOString()
          .slice(0, 10),
      after: '2029-07-15',
    },
    {
      site: '#4',
      name: 'sections.update — PATCH /sections/:id',
      mutate: (f) =>
        http
          .patch(`/api/v1/sections/${f.sectionId}`)
          .set(auth(adminToken))
          .send({ room: NEW }),
      read: async (f) =>
        (
          await prisma.section.findUniqueOrThrow({
            where: { id: f.sectionId },
            select: { room: true },
          })
        ).room,
      after: NEW,
    },
    {
      site: '#18',
      name: 'exams.update — PATCH /exams/:id',
      mutate: (f) =>
        http
          .patch(`/api/v1/exams/${f.examId}`)
          .set(auth(adminToken))
          .send({ title: NEW }),
      read: async (f) =>
        (
          await prisma.exam.findUniqueOrThrow({
            where: { id: f.examId },
            select: { title: true },
          })
        ).title,
      after: NEW,
    },
    {
      site: '#21',
      name: 'exams.updatePaper — PATCH /exams/:id/papers/:paperId',
      mutate: (f) =>
        http
          .patch(`/api/v1/exams/${f.examId}/papers/${f.paperId}`)
          .set(auth(adminToken))
          .send({ room: NEW }),
      read: async (f) =>
        (
          await prisma.examPaper.findUniqueOrThrow({
            where: { id: f.paperId },
            select: { room: true },
          })
        ).room,
      after: NEW,
    },
    {
      site: '#25',
      name: 'timetable.updateSlot — PATCH /timetable/slots/:id',
      mutate: (f) =>
        http
          .patch(`/api/v1/timetable/slots/${f.slotId}`)
          .set(auth(adminToken))
          .send({ room: NEW }),
      read: async (f) =>
        (
          await prisma.timetableSlot.findUniqueOrThrow({
            where: { id: f.slotId },
            select: { room: true },
          })
        ).room,
      after: NEW,
    },
  ];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;

    yearId = (
      await prisma.academicYear.create({
        data: {
          collegeId,
          label: `W3A-AY-${suffix}`,
          startsOn: new Date('2029-01-01'),
          endsOn: new Date('2029-12-31'),
        },
      })
    ).id;
    const department = await prisma.department.findFirstOrThrow({
      where: { collegeId },
    });
    courseId = (
      await prisma.course.create({
        data: {
          collegeId,
          departmentId: department.id,
          code: `W3A-${suffix}`.slice(0, 12),
          title: 'N-3 Batch 1 Course',
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
    await prisma.examPaper.deleteMany({ where: { exam: { termId: { in: [] } } } });
    await prisma.exam.deleteMany({ where: { collegeId, title: { contains: `W3A-${suffix}` } } });
    await prisma.timetableSlot.deleteMany({ where: { section: { courseId } } });
    await prisma.section.deleteMany({ where: { courseId } });
    await prisma.course.deleteMany({ where: { id: courseId } });
    await prisma.term.deleteMany({ where: { academicYearId: yearId } });
    await prisma.academicYear.deleteMany({ where: { id: yearId } });
    await app.close();
  });

  describe('A. a CLOSED term refuses the mutation and leaves the row untouched', () => {
    it.each(scenarios.map((s) => [s.site, s.name, s] as const))(
      '%s %s',
      async (_site, _name, scenario) => {
        const f = await freshFixture('A');
        try {
          const before = await scenario.read(f);
          expect((await closeTerm(f.termId, f.termLabel)).status).toBe(201);
          expectClosed(await scenario.mutate(f));
          expect(await scenario.read(f)).toBe(before);
        } finally {
          await dropFixture(f);
        }
      },
    );
  });

  describe('B. an OPEN term permits the mutation and the row really changes', () => {
    it.each(scenarios.map((s) => [s.site, s.name, s] as const))(
      '%s %s',
      async (_site, _name, scenario) => {
        const f = await freshFixture('B');
        try {
          const res = await scenario.mutate(f);
          expect(res.status).toBe(200);
          expect(await scenario.read(f)).toBe(scenario.after);
        } finally {
          await dropFixture(f);
        }
      },
    );
  });

  describe('C. close racing the mutation (real Postgres) upholds the invariant', () => {
    it.each(scenarios.map((s) => [s.site, s.name, s] as const))(
      '%s %s',
      async (_site, _name, scenario) => {
        // Several rounds — interleaving is probabilistic, so repeat.
        for (let round = 0; round < 4; round += 1) {
          const f = await freshFixture(`C${round}`);
          try {
            const before = await scenario.read(f);
            const [close, mutation] = await Promise.all([
              closeTerm(f.termId, f.termLabel),
              scenario.mutate(f),
            ]);
            expect(close.status).toBe(201);
            const now = await scenario.read(f);
            if (mutation.status === 200) {
              // The mutation won: it committed while the term was still
              // open, holding FOR SHARE, and the close waited behind it.
              expect(now).toBe(scenario.after);
            } else {
              // The close won: the mutation is refused and NOTHING moved.
              expectClosed(mutation);
              expect(now).toBe(before);
            }
          } finally {
            await dropFixture(f);
          }
        }
      },
    );
  });

  /**
   * MUTATION VERIFICATION for N-3, at the lock level, on real Postgres and
   * without mocks. This is the mechanism the five fixes depend on, and it is
   * exactly what the pre-fix code did not have.
   */
  describe('D. lock semantics: FOR SHARE only serializes inside a transaction', () => {
    it('the OLD shape (guard on this.prisma) leaves NO lock behind, so a close is never blocked', async () => {
      const f = await freshFixture('D1');
      try {
        // Precisely the pre-fix call shape: the guard's FOR SHARE runs in
        // its own implicit transaction, which commits immediately.
        await prisma.$queryRaw`
          SELECT "status" FROM "Term"
          WHERE id = ${f.termId} AND "collegeId" = ${collegeId}
          FOR SHARE`;

        // A close's FOR UPDATE acquires instantly — the guard is gone. This
        // is the N-3 window: the term can commit CLOSED right here, between
        // the assertion and the write.
        const acquired = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SET LOCAL lock_timeout = '2s'`;
          await tx.$queryRaw`SELECT "status" FROM "Term" WHERE id = ${f.termId} FOR UPDATE`;
          return true;
        });
        expect(acquired).toBe(true);
      } finally {
        await dropFixture(f);
      }
    });

    it('the FIXED shape (guard on tx) HOLDS the lock, so a concurrent close must wait', async () => {
      const f = await freshFixture('D2');
      try {
        let blocked: unknown = null;
        await prisma.$transaction(async (tx) => {
          // The post-fix call shape: the guard runs on the transaction
          // client, so FOR SHARE is held for the rest of the transaction —
          // i.e. across the mutation that follows it.
          await tx.$queryRaw`
            SELECT "status" FROM "Term"
            WHERE id = ${f.termId} AND "collegeId" = ${collegeId}
            FOR SHARE`;

          // A concurrent close (FOR UPDATE) on a SEPARATE connection cannot
          // proceed while that FOR SHARE is held; it times out instead.
          try {
            await prisma.$transaction(async (other) => {
              await other.$queryRaw`SET LOCAL lock_timeout = '2s'`;
              await other.$queryRaw`SELECT "status" FROM "Term" WHERE id = ${f.termId} FOR UPDATE`;
            });
          } catch (error) {
            blocked = error;
          }
        });
        expect(blocked).not.toBeNull();
        expect(String(blocked)).toMatch(/lock timeout|canceling statement|55P03|timeout/i);
      } finally {
          await dropFixture(f);
        }
      });
  });

  /**
   * E. DETERMINISTIC discriminator — the test that actually fails without the
   * fix (groups A–C hold either way, and D exercises raw SQL rather than the
   * service, so neither one distinguishes the two shapes).
   *
   * `updatePaper` is used because its pre-guard read touches only `Exam`,
   * while its first POST-guard read touches `ExamPaper`. Parking the request
   * on an `ExamPaper` table lock therefore freezes it precisely inside the
   * N-3 window: past the preflight assertion, before the transaction opens.
   * A close is then committed while the request is parked — which the
   * pre-fix code permitted, because its preflight `FOR SHARE` had already
   * been released. Releasing the table lock lets the request proceed into
   * its transaction against a term that is now CLOSED.
   *
   * Post-fix the in-transaction assertion sees the committed CLOSED state
   * and refuses (409, nothing written). Pre-fix there is no assertion left
   * to run and the update commits into a closed term — verified by reverting
   * the five fixes, at which point this test fails on the mutation status
   * and on the persisted row.
   *
   * The parking is confirmed through `pg_stat_activity` rather than a sleep,
   * so the interleaving is observed, not assumed.
   */
  describe('E. deterministic proof: a close committed inside the N-3 window cannot be written past', () => {
    it('#21 updatePaper — request parked after the preflight guard is refused once the term closes', async () => {
      const f = await freshFixture('E');
      const before = await prisma.examPaper.findUniqueOrThrow({
        where: { id: f.paperId },
        select: { room: true },
      });

      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });

      // Hold an ACCESS EXCLUSIVE lock on ExamPaper: this blocks even a plain
      // SELECT, which is what parks the in-flight request.
      const lockHeld = prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(
            'LOCK TABLE "ExamPaper" IN ACCESS EXCLUSIVE MODE',
          );
          await held;
        },
        { timeout: 60_000, maxWait: 20_000 },
      );

      let mutation: request.Response | undefined;
      try {
        // Wait until the lock is actually held.
        await waitFor(async () => {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM pg_locks
            WHERE relation = '"ExamPaper"'::regclass
              AND mode = 'AccessExclusiveLock' AND granted`;
          return Number(rows[0].n) > 0;
        }, 'ExamPaper table lock to be held');

        // Fire the mutation. It clears requireExam (Exam) and the PREFLIGHT
        // term assertion, then blocks on the ExamPaper read.
        const inFlight = http
          .patch(`/api/v1/exams/${f.examId}/papers/${f.paperId}`)
          .set(auth(adminToken))
          .send({ room: NEW })
          .then((res) => res);

        // Observe that it really is parked waiting on that lock.
        await waitFor(async () => {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND state = 'active'`;
          return Number(rows[0].n) > 0;
        }, 'the update request to park on the ExamPaper lock');

        // The N-3 window: close the term while the request sits inside it.
        // This succeeds precisely because the preflight assertion holds no
        // lock any more — the defect N-3 describes.
        const close = await closeTerm(f.termId, f.termLabel);
        expect(close.status).toBe(201);

        // Let the parked request continue into its transaction.
        release();
        await lockHeld;
        mutation = await inFlight;
      } finally {
        release();
        await lockHeld.catch(() => undefined);
      }

      // The mutation resumed against a term that is now CLOSED. The
      // in-transaction assertion must refuse it, and nothing may be written.
      expectClosed(mutation!);
      const after = await prisma.examPaper.findUniqueOrThrow({
        where: { id: f.paperId },
        select: { room: true },
      });
      expect(after.room).toBe(before.room);
      expect(after.room).not.toBe(NEW);

      await dropFixture(f);
    }, 90_000);
  });
});

async function waitFor(
  probe: () => Promise<boolean>,
  what: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${what}`);
}
