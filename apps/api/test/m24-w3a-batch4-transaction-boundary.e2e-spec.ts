import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M24-W3a — N-3 Batch 4: assignments.update (assessment site #10).
 *
 * FINDING (N-3). `assertSectionTermOpen` takes the Prisma client as its
 * first argument and locks the owning Term row `FOR SHARE`, which is what
 * serializes a write against `close()`'s `FOR UPDATE`. That lock lives only
 * as long as the enclosing transaction, so calling the guard on
 * `this.prisma` ran it in its own implicit single-statement transaction —
 * committing, and releasing the lock, before the guard even returned.
 *
 * #10 is the one site that ALREADY owned an interactive transaction
 * containing several dependent writes, but ran the guard outside it:
 *
 *     assignment.update            (the edit itself)
 *     submission.updateMany  ×2    (M24-W3b/N-14 `isLate` recomputation)
 *
 * A term could therefore commit CLOSED between the assertion and those
 * writes, and the whole group would land in a closed term. The fix adds the
 * AUTHORITATIVE assertion as the first statement inside that existing
 * transaction; the pre-existing preflight is deliberately retained because
 * it is what makes TERM_CLOSED precede MAX_POINTS_BELOW_GRADES, and the
 * grade probe stays outside so the lock window covers writes only. Exactly
 * one transaction boundary, no nesting. `audit.logAtomic(…, tx)` was
 * already inside this transaction (M23-W2) and is untouched; the method
 * emits no events.
 *
 * Coverage: (A) closed term rejects, assignment AND submissions unchanged;
 * (B) open term succeeds and BOTH halves of the atomic edit land; (C) a
 * live close/update race; (D) a deterministic discriminator proving the
 * lifecycle lock is held while the mutations execute — it fails against the
 * pre-fix source.
 */
describe('M24-W3a — N-3 Batch 4: assignments.update transaction boundary', () => {
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
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const FUTURE = '2099-01-01T00:00:00.000Z';
  const PAST = '2020-01-01T00:00:00.000Z';

  interface Fixture {
    termId: string;
    termLabel: string;
    sectionId: string;
    assignmentId: string;
    submissionId: string;
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

  /** PATCH the due date into the past — this is the edit under test. */
  const mutate = (f: Fixture) =>
    http
      .patch(`/api/v1/assignments/${f.assignmentId}`)
      .set(auth(adminToken))
      .send({ dueAt: PAST });

  /**
   * Observe BOTH halves of the atomic operation straight from the database:
   * the assignment's own due date and the derived `isLate` flag on its
   * submission. A partial commit would show up here as a mismatch.
   */
  async function state(f: Fixture): Promise<string> {
    const a = await prisma.assignment.findUniqueOrThrow({
      where: { id: f.assignmentId },
      select: { dueAt: true },
    });
    const s = await prisma.submission.findUniqueOrThrow({
      where: { id: f.submissionId },
      select: { isLate: true },
    });
    return `${a.dueAt.toISOString().slice(0, 10)}/${s.isLate}`;
  }
  const BEFORE = '2099-01-01/false';
  const DONE = '2020-01-01/true';

  let seq = 0;
  async function freshFixture(tag: string): Promise<Fixture> {
    const label = `W3AB4-${suffix}-${tag}-${(seq += 1)}`;
    const term = await prisma.term.create({
      data: {
        collegeId,
        academicYearId: yearId,
        label,
        startsOn: new Date('2032-01-01'),
        endsOn: new Date('2032-06-30'),
      },
    });
    const section = await prisma.section.create({
      data: { collegeId, courseId, termId: term.id, name: `S${seq}`, capacity: 30 },
    });
    await prisma.enrollment.create({
      data: { sectionId: section.id, studentId: studentProfileId, status: 'ACTIVE' },
    });
    const assignment = await prisma.assignment.create({
      data: {
        sectionId: section.id,
        title: `${label}-hw`,
        description: 'hw',
        createdById: adminUserId,
        maxPoints: 100,
        dueAt: new Date(FUTURE),
        allowLate: true,
        publishedAt: new Date(),
      },
    });
    // Submitted now, i.e. comfortably before the FUTURE due date → on time.
    const submission = await prisma.submission.create({
      data: {
        assignmentId: assignment.id,
        studentId: studentProfileId,
        textContent: 'answer',
        isLate: false,
        submittedAt: new Date(),
      },
    });
    return {
      termId: term.id,
      termLabel: label,
      sectionId: section.id,
      assignmentId: assignment.id,
      submissionId: submission.id,
    };
  }

  async function dropFixture(f: Fixture) {
    await prisma.submission.deleteMany({
      where: { assignment: { section: { termId: f.termId } } },
    });
    await prisma.assignment.deleteMany({ where: { section: { termId: f.termId } } });
    await prisma.enrollment.deleteMany({ where: { section: { termId: f.termId } } });
    await prisma.section.deleteMany({ where: { termId: f.termId } });
    await prisma.term.deleteMany({ where: { id: f.termId } });
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
    const student = await prisma.user.findFirstOrThrow({
      where: { email: 'student@campusos.dev' },
      include: { studentProfile: true },
    });
    studentProfileId = student.studentProfile!.id;

    yearId = (
      await prisma.academicYear.create({
        data: {
          collegeId,
          label: `W3AB4-AY-${suffix}`,
          startsOn: new Date('2032-01-01'),
          endsOn: new Date('2032-12-31'),
        },
      })
    ).id;
    const department = await prisma.department.findFirstOrThrow({ where: { collegeId } });
    courseId = (
      await prisma.course.create({
        data: {
          collegeId,
          departmentId: department.id,
          code: `W3B4-${suffix}`.slice(0, 12),
          title: 'N-3 Batch 4 Course',
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

  it('A. a CLOSED term refuses the update; assignment AND submissions unchanged', async () => {
    const f = await freshFixture('A');
    try {
      expect(await state(f)).toBe(BEFORE);
      expect((await closeTerm(f.termId, f.termLabel)).status).toBe(201);
      expectClosed(await mutate(f));
      // Database-level assertion, not merely the HTTP status.
      expect(await state(f)).toBe(BEFORE);
      expect(await state(f)).not.toBe(DONE);
    } finally {
      await dropFixture(f);
    }
  }, 60_000);

  it('B. an OPEN term permits the update; both the due date and isLate land', async () => {
    const f = await freshFixture('B');
    try {
      const res = await mutate(f);
      expect(res.status).toBe(200);
      expect(await state(f)).toBe(DONE);
    } finally {
      await dropFixture(f);
    }
  }, 60_000);

  it('C. close racing the update upholds the invariant (real Postgres)', async () => {
    for (let round = 0; round < 4; round += 1) {
      const f = await freshFixture(`C${round}`);
      try {
        const [close, update] = await Promise.all([
          closeTerm(f.termId, f.termLabel),
          mutate(f),
        ]);
        expect(close.status).toBe(201);
        const now = await state(f);
        if (update.status === 200) {
          // Committed while the term was still open, holding FOR SHARE —
          // and BOTH halves landed, never a partial edit.
          expect(now).toBe(DONE);
        } else {
          // Refused, and nothing moved. Never "200 + closed + committed".
          expectClosed(update);
          expect(now).toBe(BEFORE);
        }
      } finally {
        await dropFixture(f);
      }
    }
  }, 120_000);

  /**
   * D. DISCRIMINATOR — proves the lifecycle lock is HELD while the
   * assignment/submission mutations execute.
   *
   * `LOCK TABLE "Assignment" IN EXCLUSIVE MODE` conflicts with the
   * ROW EXCLUSIVE an UPDATE needs, but NOT with the ACCESS SHARE a plain
   * SELECT needs — so `requireManaged`'s own read of Assignment passes
   * straight through and the request parks precisely on
   * `tx.assignment.update`, i.e. inside the transaction and after the
   * preflight. (The request sends only `dueAt`, so the MAX_POINTS grade
   * probe is skipped.) A separate connection then probes the Term row with
   * `FOR UPDATE` — the first thing `close()` does.
   *
   *   FIXED   — the authoritative assertion ran on `tx` and still holds
   *             FOR SHARE, so the probe cannot acquire and times out.
   *   PRE-FIX — the guard ran on `this.prisma` and released its lock before
   *             returning, so the probe acquires at once: a close could
   *             commit right here and all three writes would land in a
   *             closed term.
   *
   * A table-level lock takes nothing on Term, so the parker can never
   * contaminate the probe. Parking is observed via `pg_locks`, not slept on.
   */
  it('D. the lifecycle lock is held while the assignment/submission writes execute', async () => {
    const f = await freshFixture('D');
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    class Rollback extends Error {}

    const parker = prisma
      .$transaction(
        async (tx) => {
          await (tx as unknown as {
            $executeRawUnsafe(q: string): Promise<unknown>;
          }).$executeRawUnsafe('LOCK TABLE "Assignment" IN EXCLUSIVE MODE');
          await held;
          throw new Rollback();
        },
        { timeout: 120_000, maxWait: 30_000 },
      )
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });

    let probeBlocked: boolean | null = null;
    let update: request.Response | undefined;
    try {
      await settle();
      // supertest requests are lazy — the await inside this IIFE dispatches.
      const inFlight = (async () => await mutate(f))();
      await waitFor(async () => {
        const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*) AS n FROM pg_locks WHERE NOT granted`;
        return Number(rows[0].n) > 0;
      }, 'the update to park on tx.assignment.update');

      probeBlocked = await termLockBlocked(f.termId);

      release();
      await parker;
      update = await inFlight;
    } finally {
      release();
      await parker.catch(() => undefined);
    }

    // The crux of N-3 for site #10.
    expect(probeBlocked).toBe(true);

    // And the edit still completed correctly against the open term.
    expect(update!.status).toBe(200);
    expect(await state(f)).toBe(DONE);

    await dropFixture(f);
  }, 120_000);

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
