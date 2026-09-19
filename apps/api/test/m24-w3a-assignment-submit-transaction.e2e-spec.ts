import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/** M24-W3a — N-3 #13: submission lifecycle lock and upsert share one tx. */
describe('M24-W3a — N-3 #13 assignments.submit transaction boundary', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let studentToken: string;
  let collegeId: string;
  let departmentId: string;
  let studentId: string;
  let adminId: string;
  const suffix = Date.now().toString(36);
  const auth = () => ({ Authorization: `Bearer ${studentToken}` });

  interface Fixture {
    yearId: string;
    termId: string;
    courseId: string;
    sectionId: string;
    assignmentId: string;
  }

  async function freshFixture(): Promise<Fixture> {
    const year = await prisma.academicYear.create({
      data: {
        collegeId,
        label: `W3AS-${suffix}-AY`,
        startsOn: new Date('2037-01-01'),
        endsOn: new Date('2037-12-31'),
      },
    });
    const term = await prisma.term.create({
      data: {
        collegeId,
        academicYearId: year.id,
        label: `W3AS-${suffix}-TERM`,
        startsOn: new Date('2037-01-01'),
        endsOn: new Date('2037-06-30'),
      },
    });
    const course = await prisma.course.create({
      data: {
        collegeId,
        departmentId,
        code: `W3AS-${suffix}`.slice(0, 24),
        title: 'N-3 #13 submission course',
        credits: 3,
      },
    });
    const section = await prisma.section.create({
      data: {
        collegeId,
        courseId: course.id,
        termId: term.id,
        name: 'A',
        capacity: 30,
      },
    });
    await prisma.enrollment.create({
      data: { sectionId: section.id, studentId, status: 'ACTIVE' },
    });
    const assignment = await prisma.assignment.create({
      data: {
        sectionId: section.id,
        title: `W3AS-${suffix}`,
        description: 'transaction boundary fixture',
        dueAt: new Date('2099-01-01'),
        maxPoints: 100,
        allowLate: false,
        publishedAt: new Date(),
        createdById: adminId,
      },
    });
    return {
      yearId: year.id,
      termId: term.id,
      courseId: course.id,
      sectionId: section.id,
      assignmentId: assignment.id,
    };
  }

  async function dropFixture(f: Fixture): Promise<void> {
    await prisma.auditLog.deleteMany({
      where: {
        targetType: 'Assignment',
        targetId: f.assignmentId,
        action: { in: ['submissions.created', 'submissions.resubmitted'] },
      },
    });
    await prisma.submission.deleteMany({ where: { assignmentId: f.assignmentId } });
    await prisma.assignment.delete({ where: { id: f.assignmentId } });
    await prisma.enrollment.deleteMany({ where: { sectionId: f.sectionId } });
    await prisma.section.delete({ where: { id: f.sectionId } });
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
    const student = await prisma.user.findFirstOrThrow({
      where: { email: 'student@campusos.dev' },
      include: { studentProfile: true },
    });
    adminId = admin.id;
    collegeId = admin.collegeId;
    studentId = student.studentProfile!.id;
    departmentId = (
      await prisma.department.findFirstOrThrow({ where: { collegeId } })
    ).id;

    app.get(LoginRateLimiterService).reset();
    const login = await http.post('/api/v1/auth/login').send({
      email: 'student@campusos.dev',
      password: DEMO_PASSWORD,
    });
    expect(login.status).toBe(200);
    studentToken = login.body.data.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('holds the owning Term FOR SHARE through the protected submission upsert', async () => {
    const f = await freshFixture();
    try {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      class Rollback extends Error {}

      // EXCLUSIVE allows all preflight SELECTs, then parks the transaction on
      // its authoritative Submission FOR UPDATE immediately before the upsert.
      const parker = prisma
        .$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(
              'LOCK TABLE "Submission" IN EXCLUSIVE MODE',
            );
            await held;
            throw new Rollback();
          },
          { timeout: 120_000, maxWait: 30_000 },
        )
        .catch((error) => {
          if (!(error instanceof Rollback)) throw error;
        });

      let response: request.Response | undefined;
      let termBlocked = false;
      try {
        await waitFor(async () => {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM pg_locks
            WHERE relation = '"Submission"'::regclass
              AND mode = 'ExclusiveLock' AND granted`;
          return Number(rows[0].n) > 0;
        }, 'Submission table lock');

        const inFlight = (async () =>
          await http
            .post(`/api/v1/assignments/${f.assignmentId}/submissions`)
            .set(auth())
            .send({ textContent: 'authoritative answer' }))();

        await waitFor(async () => {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM pg_locks
            WHERE relation = '"Submission"'::regclass AND NOT granted`;
          return Number(rows[0].n) > 0;
        }, 'submission mutation to park');

        termBlocked = await termLockBlocked(f.termId);
        release();
        await parker;
        response = await inFlight;
      } finally {
        release();
        await parker.catch(() => undefined);
      }

      expect(termBlocked).toBe(true);
      expect(response!.status).toBe(201);
      expect(response!.body.data.mySubmissionContent.textContent).toBe(
        'authoritative answer',
      );
      const persisted = await prisma.submission.findUniqueOrThrow({
        where: {
          assignmentId_studentId: {
            assignmentId: f.assignmentId,
            studentId,
          },
        },
      });
      expect(persisted.textContent).toBe('authoritative answer');
      expect(persisted.isLate).toBe(false);
      expect(
        await prisma.submission.count({
          where: { assignmentId: f.assignmentId, studentId },
        }),
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
