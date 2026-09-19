import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M24-W3a — N-3 #24 + N-16b timetable transaction integrity.
 *
 * Create and update serialize on the owning Term row before authoritative
 * lifecycle, conflict, and mutation work. The controlled races below use a
 * real PostgreSQL table lock to park the first writer on its mutation while
 * the second waits on Term FOR UPDATE. No sleeps or mocked lock behavior.
 */
describe('M24-W3a — N-3 #24 + N-16b timetable concurrency', () => {
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
    termId: string;
    courseId: string;
    sectionA: string;
    sectionB: string;
  }

  async function freshFixture(tag: string): Promise<Fixture> {
    const label = `W3AN16-${suffix}-${tag}`;
    const year = await prisma.academicYear.create({
      data: {
        collegeId,
        label: `${label}-AY`,
        startsOn: new Date('2035-01-01'),
        endsOn: new Date('2035-12-31'),
      },
    });
    const term = await prisma.term.create({
      data: {
        collegeId,
        academicYearId: year.id,
        label,
        startsOn: new Date('2035-01-01'),
        endsOn: new Date('2035-06-30'),
      },
    });
    const course = await prisma.course.create({
      data: {
        collegeId,
        departmentId,
        code: `N16-${suffix}-${tag}`.slice(0, 24),
        title: `N-16b ${tag}`,
        credits: 3,
      },
    });
    const [sectionA, sectionB] = await Promise.all([
      prisma.section.create({
        data: {
          collegeId,
          courseId: course.id,
          termId: term.id,
          name: 'A',
          capacity: 30,
          room: 'N16-SHARED',
        },
      }),
      prisma.section.create({
        data: {
          collegeId,
          courseId: course.id,
          termId: term.id,
          name: 'B',
          capacity: 30,
          room: 'N16-SHARED',
        },
      }),
    ]);
    return {
      yearId: year.id,
      termId: term.id,
      courseId: course.id,
      sectionA: sectionA.id,
      sectionB: sectionB.id,
    };
  }

  async function dropFixture(f: Fixture): Promise<void> {
    const slots = await prisma.timetableSlot.findMany({
      where: { sectionId: { in: [f.sectionA, f.sectionB] } },
      select: { id: true },
    });
    await prisma.auditLog.deleteMany({
      where: {
        targetType: 'TimetableSlot',
        targetId: { in: slots.map((slot) => slot.id) },
      },
    });
    await prisma.timetableSlot.deleteMany({
      where: { sectionId: { in: [f.sectionA, f.sectionB] } },
    });
    await prisma.section.deleteMany({
      where: { id: { in: [f.sectionA, f.sectionB] } },
    });
    await prisma.course.delete({ where: { id: f.courseId } });
    await prisma.term.delete({ where: { id: f.termId } });
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

  it('serializes concurrent creates so only one same-section slot commits', async () => {
    const f = await freshFixture('create');
    try {
      const create = async () =>
        await http.post('/api/v1/timetable/slots').set(auth()).send({
          sectionId: f.sectionA,
          dayOfWeek: 2,
          startTime: '09:00',
          endTime: '10:00',
        });

      const { responses, termBlocked } = await runParkedPair(
        f.termId,
        create,
        create,
      );
      expect(termBlocked).toBe(true);
      expect(responses.map((res) => res.status).sort()).toEqual([201, 400]);
      expect(responses.find((res) => res.status === 400)!.body.error.code).toBe(
        'SLOT_CONFLICT',
      );
      expect(
        await prisma.timetableSlot.count({
          where: {
            sectionId: f.sectionA,
            dayOfWeek: 2,
            startTime: '09:00',
            endTime: '10:00',
          },
        }),
      ).toBe(1);
    } finally {
      await dropFixture(f);
    }
  }, 180_000);

  it('serializes concurrent updates so only one effective-room conflict commits', async () => {
    const f = await freshFixture('update');
    try {
      const [slotA, slotB] = await Promise.all([
        prisma.timetableSlot.create({
          data: {
            sectionId: f.sectionA,
            dayOfWeek: 1,
            startTime: '08:00',
            endTime: '09:00',
          },
        }),
        prisma.timetableSlot.create({
          data: {
            sectionId: f.sectionB,
            dayOfWeek: 1,
            startTime: '10:00',
            endTime: '11:00',
          },
        }),
      ]);
      const update = (id: string) => async () =>
        await http.patch(`/api/v1/timetable/slots/${id}`).set(auth()).send({
          dayOfWeek: 3,
          startTime: '13:00',
          endTime: '14:00',
        });

      const { responses, termBlocked } = await runParkedPair(
        f.termId,
        update(slotA.id),
        update(slotB.id),
      );
      expect(termBlocked).toBe(true);
      expect(responses.map((res) => res.status).sort()).toEqual([200, 400]);
      expect(responses.find((res) => res.status === 400)!.body.error.code).toBe(
        'ROOM_CONFLICT',
      );
      expect(
        await prisma.timetableSlot.count({
          where: {
            sectionId: { in: [f.sectionA, f.sectionB] },
            dayOfWeek: 3,
            startTime: '13:00',
            endTime: '14:00',
          },
        }),
      ).toBe(1);
    } finally {
      await dropFixture(f);
    }
  }, 180_000);

  async function runParkedPair(
    termId: string,
    firstMutation: () => Promise<request.Response>,
    secondMutation: () => Promise<request.Response>,
  ): Promise<{
    responses: [request.Response, request.Response];
    termBlocked: boolean;
  }> {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    class Rollback extends Error {}

    // EXCLUSIVE allows preflight/conflict SELECTs but blocks INSERT/UPDATE.
    // The first fixed writer parks on TimetableSlot while holding Term FOR
    // UPDATE; the second fixed writer consequently parks on that Term.
    const parker = prisma
      .$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(
            'LOCK TABLE "TimetableSlot" IN EXCLUSIVE MODE',
          );
          await held;
          throw new Rollback();
        },
        { timeout: 120_000, maxWait: 30_000 },
      )
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });

    try {
      await waitFor(async () => {
        const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*) AS n FROM pg_locks
          WHERE relation = '"TimetableSlot"'::regclass
            AND mode = 'ExclusiveLock' AND granted`;
        return Number(rows[0].n) > 0;
      }, 'TimetableSlot table lock');

      const first = (async () => await firstMutation())();
      const second = (async () => await secondMutation())();
      await waitFor(async () => {
        const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*) AS n FROM pg_locks WHERE NOT granted`;
        return Number(rows[0].n) >= 2;
      }, 'both timetable writers to park');

      // The critical-section owner must retain Term FOR UPDATE while parked
      // on its mutation. A competing lifecycle/writer lock cannot acquire.
      const termBlocked = await termLockBlocked(termId);

      release();
      await parker;
      return {
        responses: await Promise.all([first, second]),
        termBlocked,
      };
    } finally {
      release();
      await parker.catch(() => undefined);
    }
  }

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
