import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/** M24-W3a — N-3 #2: createDraft lifecycle lock and mutation share one tx. */
describe('M24-W3a — N-3 #2 rollover.createDraft transaction boundary', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let adminToken: string;
  let collegeId: string;
  let departmentId: string;
  const suffix = Date.now().toString(36);
  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  interface Fixture {
    yearId: string;
    fromTermId: string;
    toTermId: string;
    courseId: string;
    sectionId: string;
  }

  async function freshFixture(): Promise<Fixture> {
    const year = await prisma.academicYear.create({
      data: {
        collegeId,
        label: `W3AR-${suffix}-AY`,
        startsOn: new Date('2036-01-01'),
        endsOn: new Date('2036-12-31'),
      },
    });
    const [fromTerm, toTerm] = await Promise.all([
      prisma.term.create({
        data: {
          collegeId,
          academicYearId: year.id,
          label: `W3AR-${suffix}-FROM`,
          startsOn: new Date('2036-01-01'),
          endsOn: new Date('2036-06-30'),
        },
      }),
      prisma.term.create({
        data: {
          collegeId,
          academicYearId: year.id,
          label: `W3AR-${suffix}-TO`,
          startsOn: new Date('2036-07-01'),
          endsOn: new Date('2036-12-31'),
        },
      }),
    ]);
    const course = await prisma.course.create({
      data: {
        collegeId,
        departmentId,
        code: `W3AR-${suffix}`.slice(0, 24),
        title: 'N-3 #2 rollover course',
        credits: 3,
      },
    });
    const section = await prisma.section.create({
      data: {
        collegeId,
        courseId: course.id,
        termId: fromTerm.id,
        name: 'A',
        capacity: 30,
      },
    });
    return {
      yearId: year.id,
      fromTermId: fromTerm.id,
      toTermId: toTerm.id,
      courseId: course.id,
      sectionId: section.id,
    };
  }

  async function dropFixture(f: Fixture): Promise<void> {
    await prisma.auditLog.deleteMany({
      where: { action: 'terms.rollover_drafted', targetId: f.toTermId },
    });
    await prisma.termRollover.deleteMany({ where: { toTermId: f.toTermId } });
    await prisma.section.delete({ where: { id: f.sectionId } });
    await prisma.course.delete({ where: { id: f.courseId } });
    await prisma.term.deleteMany({
      where: { id: { in: [f.fromTermId, f.toTermId] } },
    });
    await prisma.academicYear.delete({ where: { id: f.yearId } });
  }

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

    app.get(LoginRateLimiterService).reset();
    const login = await http.post('/api/v1/auth/login').send({
      email: 'admin@campusos.dev',
      password: DEMO_PASSWORD,
    });
    expect(login.status).toBe(200);
    adminToken = login.body.data.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('holds destination Term FOR SHARE through the draft INSERT', async () => {
    const f = await freshFixture();
    try {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      class Rollback extends Error {}

      // EXCLUSIVE allows all preflight and authoritative SELECTs but parks
      // termRollover.create on its INSERT while the surrounding tx stays open.
      const parker = prisma
        .$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(
              'LOCK TABLE "TermRollover" IN EXCLUSIVE MODE',
            );
            await held;
            throw new Rollback();
          },
          { timeout: 120_000, maxWait: 30_000 },
        )
        .catch((error) => {
          if (!(error instanceof Rollback)) throw error;
        });

      let draft: request.Response | undefined;
      let termBlocked = false;
      try {
        await waitFor(async () => {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM pg_locks
            WHERE relation = '"TermRollover"'::regclass
              AND mode = 'ExclusiveLock' AND granted`;
          return Number(rows[0].n) > 0;
        }, 'TermRollover table lock');

        const inFlight = (async () =>
          await http
            .post(`/api/v1/terms/${f.toTermId}/rollover`)
            .set(auth())
            .send({ fromTermId: f.fromTermId }))();

        await waitFor(async () => {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM pg_locks
            WHERE relation = '"TermRollover"'::regclass AND NOT granted`;
          return Number(rows[0].n) > 0;
        }, 'createDraft INSERT to park');

        termBlocked = await termLockBlocked(f.toTermId);
        release();
        await parker;
        draft = await inFlight;
      } finally {
        release();
        await parker.catch(() => undefined);
      }

      expect(termBlocked).toBe(true);
      expect(draft!.status).toBe(201);
      expect(draft!.body.data).toMatchObject({
        status: 'DRAFT',
        fromTermId: f.fromTermId,
        toTermId: f.toTermId,
      });
      expect(draft!.body.data.sections).toHaveLength(1);
      expect(
        await prisma.termRollover.count({ where: { toTermId: f.toTermId } }),
      ).toBe(1);
    } finally {
      await dropFixture(f);
    }
  }, 180_000);

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
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(`Timed out waiting for ${what}`);
  }
});
