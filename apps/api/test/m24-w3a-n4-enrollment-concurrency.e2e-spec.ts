import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { LoginRateLimiterService } from "../src/auth/login-rate-limiter.service";
import { createTestApp } from "./test-app";

const DEMO_PASSWORD = "CampusOS!demo1";

/**
 * M24-W3a — N-4 + N-3 #5: enrollment capacity and lifecycle integrity.
 *
 * `enroll` now owns one interactive transaction in lock order Term → Section.
 * Its term guard holds FOR SHARE through the enrollment write; its Section
 * FOR UPDATE lock serializes all contenders before capacity is re-read.
 */
describe("M24-W3a — N-4 + N-3 #5 enrollment transaction integrity", () => {
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
    termLabel: string;
    courseId: string;
    sectionId: string;
    userIds: string[];
    studentIds: string[];
  }

  const enroll = (sectionId: string, studentId: string) =>
    http
      .post(`/api/v1/sections/${sectionId}/enrollments/${studentId}`)
      .set(auth());

  async function freshFixture(tag: string): Promise<Fixture> {
    const label = `W3AN4-${suffix}-${tag}`;
    const year = await prisma.academicYear.create({
      data: {
        collegeId,
        label: `${label}-AY`,
        startsOn: new Date("2034-01-01"),
        endsOn: new Date("2034-12-31"),
      },
    });
    const term = await prisma.term.create({
      data: {
        collegeId,
        academicYearId: year.id,
        label,
        startsOn: new Date("2034-01-01"),
        endsOn: new Date("2034-06-30"),
      },
    });
    const course = await prisma.course.create({
      data: {
        collegeId,
        departmentId,
        code: `N4-${suffix}-${tag}`.slice(0, 24),
        title: `N-4 ${tag}`,
        credits: 3,
      },
    });
    const section = await prisma.section.create({
      data: {
        collegeId,
        courseId: course.id,
        termId: term.id,
        name: "A",
        capacity: 30,
      },
    });

    const userIds: string[] = [];
    const studentIds: string[] = [];
    for (let index = 0; index < 31; index += 1) {
      const user = await prisma.user.create({
        data: {
          collegeId,
          email: `n4-${suffix}-${tag}-${index}@campusos.dev`,
          role: "STUDENT",
          firstName: "N4",
          lastName: `${tag}-${index}`,
          studentProfile: {
            create: {
              collegeId,
              departmentId,
              admissionNo: `N4-${suffix}-${tag}-${index}`,
              rollNo: `N4-${tag}-${index}`,
              batch: "2034",
            },
          },
        },
        include: { studentProfile: true },
      });
      userIds.push(user.id);
      studentIds.push(user.studentProfile!.id);
    }

    await prisma.enrollment.createMany({
      data: studentIds.slice(0, 29).map((studentId) => ({
        sectionId: section.id,
        studentId,
        status: "ACTIVE",
      })),
    });

    return {
      yearId: year.id,
      termId: term.id,
      termLabel: term.label,
      courseId: course.id,
      sectionId: section.id,
      userIds,
      studentIds,
    };
  }

  async function dropFixture(f: Fixture): Promise<void> {
    await prisma.enrollment.deleteMany({ where: { sectionId: f.sectionId } });
    await prisma.section.delete({ where: { id: f.sectionId } });
    await prisma.course.delete({ where: { id: f.courseId } });
    await prisma.studentProfile.deleteMany({
      where: { id: { in: f.studentIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: f.userIds } } });
    await prisma.term.delete({ where: { id: f.termId } });
    await prisma.academicYear.delete({ where: { id: f.yearId } });
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: "admin@campusos.dev" },
    });
    collegeId = admin.collegeId;
    departmentId = (
      await prisma.department.findFirstOrThrow({ where: { collegeId } })
    ).id;

    app.get(LoginRateLimiterService).reset();
    const login = await http.post("/api/v1/auth/login").send({
      email: "admin@campusos.dev",
      password: DEMO_PASSWORD,
    });
    expect(login.status).toBe(200);
    adminToken = login.body.data.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it("preserves open/closed, duplicate, and re-enrollment behavior", async () => {
    const f = await freshFixture("behavior");
    try {
      const candidate = f.studentIds[29];
      const created = await enroll(f.sectionId, candidate);
      expect(created.status).toBe(201);

      const duplicate = await enroll(f.sectionId, candidate);
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe("ALREADY_ENROLLED");

      await prisma.enrollment.update({
        where: {
          studentId_sectionId: { studentId: candidate, sectionId: f.sectionId },
        },
        data: { status: "DROPPED" },
      });
      const reactivated = await enroll(f.sectionId, candidate);
      expect(reactivated.status).toBe(201);
      expect(
        await prisma.enrollment.count({
          where: { sectionId: f.sectionId, status: "ACTIVE" },
        }),
      ).toBe(30);

      await prisma.term.update({
        where: { id: f.termId },
        data: { status: "CLOSED" },
      });
      const closed = await enroll(f.sectionId, f.studentIds[30]);
      expect(closed.status).toBe(409);
      expect(closed.body.error.code).toBe("TERM_CLOSED");
    } finally {
      await dropFixture(f);
    }
  });

  it("serializes two contenders for the final seat and holds the Term lock through the write", async () => {
    const f = await freshFixture("race");
    try {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      class Rollback extends Error {}

      // EXCLUSIVE permits all preflight SELECTs but blocks both INSERTs. In
      // the fixed implementation, one request parks on Enrollment and the
      // other parks behind its Section row lock. In the vulnerable version,
      // both pass the stale count and park on their INSERTs.
      const parker = prisma
        .$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(
              'LOCK TABLE "Enrollment" IN EXCLUSIVE MODE',
            );
            await held;
            throw new Rollback();
          },
          { timeout: 120_000, maxWait: 30_000 },
        )
        .catch((error) => {
          if (!(error instanceof Rollback)) throw error;
        });

      let first: request.Response | undefined;
      let second: request.Response | undefined;
      try {
        await waitFor(async () => {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*) AS n FROM pg_locks
          WHERE relation = '"Enrollment"'::regclass
            AND mode = 'ExclusiveLock' AND granted`;
          return Number(rows[0].n) > 0;
        }, "Enrollment table lock");

        const firstInFlight = (async () =>
          await enroll(f.sectionId, f.studentIds[29]))();
        const secondInFlight = (async () =>
          await enroll(f.sectionId, f.studentIds[30]))();

        // Both requests are observed waiting: one on the Enrollment table,
        // one on either Enrollment (vulnerable) or Section (fixed).
        await waitFor(async () => {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*) AS n FROM pg_locks WHERE NOT granted`;
          return Number(rows[0].n) >= 2;
        }, "both enrollment contenders to park");

        // N-3 #5 discriminator: both fixed transactions acquired Term FOR
        // SHARE before either mutation, so close's FOR UPDATE cannot acquire.
        expect(await termLockBlocked(f.termId)).toBe(true);

        release();
        await parker;
        [first, second] = await Promise.all([firstInFlight, secondInFlight]);
      } finally {
        release();
        await parker.catch(() => undefined);
      }

      const responses = [first!, second!];
      expect(responses.map((res) => res.status).sort()).toEqual([201, 409]);
      const rejected = responses.find((res) => res.status === 409)!;
      expect(rejected.body.error.code).toBe("SECTION_FULL");
      expect(
        await prisma.enrollment.count({
          where: { sectionId: f.sectionId, status: "ACTIVE" },
        }),
      ).toBe(30);
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
