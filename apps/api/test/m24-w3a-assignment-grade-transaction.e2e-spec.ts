import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/** M24-W3a — N-3 #14: grading lifecycle lock and update share one tx. */
describe('M24-W3a — N-3 #14 assignments.grade transaction boundary', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let teacherToken: string;
  let collegeId: string;
  let departmentId: string;
  let teacherId: string;
  let teacherProfileId: string;
  const suffix = Date.now().toString(36);
  const auth = () => ({ Authorization: `Bearer ${teacherToken}` });

  interface Fixture {
    yearId: string;
    termId: string;
    courseId: string;
    sectionId: string;
    studentUserId: string;
    studentId: string;
    assignmentId: string;
    submissionId: string;
  }

  async function freshFixture(): Promise<Fixture> {
    const year = await prisma.academicYear.create({
      data: {
        collegeId,
        label: `W3AG-${suffix}-AY`,
        startsOn: new Date('2038-01-01'),
        endsOn: new Date('2038-12-31'),
      },
    });
    const term = await prisma.term.create({
      data: {
        collegeId,
        academicYearId: year.id,
        label: `W3AG-${suffix}-TERM`,
        startsOn: new Date('2038-01-01'),
        endsOn: new Date('2038-06-30'),
      },
    });
    const course = await prisma.course.create({
      data: {
        collegeId,
        departmentId,
        code: `W3AG-${suffix}`.slice(0, 24),
        title: 'N-3 #14 grading course',
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
    await prisma.teachingAssignment.create({
      data: { teacherId: teacherProfileId, sectionId: section.id },
    });
    const studentUser = await prisma.user.create({
      data: {
        collegeId,
        email: `w3ag-${suffix}@campusos.dev`,
        role: 'STUDENT',
        firstName: 'Grade',
        lastName: 'Student',
      },
    });
    const student = await prisma.studentProfile.create({
      data: {
        userId: studentUser.id,
        collegeId,
        departmentId,
        admissionNo: `W3AG-${suffix}`,
        rollNo: `W3AG-${suffix}`,
        batch: '2038',
      },
    });
    await prisma.enrollment.create({
      data: { sectionId: section.id, studentId: student.id },
    });
    const assignment = await prisma.assignment.create({
      data: {
        sectionId: section.id,
        title: `W3AG-${suffix}`,
        description: 'transaction boundary fixture',
        dueAt: new Date('2099-01-01'),
        maxPoints: 100,
        allowLate: true,
        publishedAt: new Date(),
        createdById: teacherId,
      },
    });
    const submission = await prisma.submission.create({
      data: {
        assignmentId: assignment.id,
        studentId: student.id,
        textContent: 'grade me',
        submittedAt: new Date(),
        isLate: false,
      },
    });
    return {
      yearId: year.id,
      termId: term.id,
      courseId: course.id,
      sectionId: section.id,
      studentUserId: studentUser.id,
      studentId: student.id,
      assignmentId: assignment.id,
      submissionId: submission.id,
    };
  }

  async function dropFixture(f: Fixture): Promise<void> {
    await prisma.notification.deleteMany({ where: { userId: f.studentUserId } });
    await prisma.auditLog.deleteMany({
      where: { action: 'submissions.graded', targetId: f.submissionId },
    });
    await prisma.submission.delete({ where: { id: f.submissionId } });
    await prisma.assignment.delete({ where: { id: f.assignmentId } });
    await prisma.enrollment.deleteMany({ where: { sectionId: f.sectionId } });
    await prisma.teachingAssignment.deleteMany({ where: { sectionId: f.sectionId } });
    await prisma.section.delete({ where: { id: f.sectionId } });
    await prisma.course.delete({ where: { id: f.courseId } });
    await prisma.studentProfile.delete({ where: { id: f.studentId } });
    await prisma.user.delete({ where: { id: f.studentUserId } });
    await prisma.term.delete({ where: { id: f.termId } });
    await prisma.academicYear.delete({ where: { id: f.yearId } });
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());
    const teacher = await prisma.user.findFirstOrThrow({
      where: { email: 'teacher@campusos.dev' },
      include: { teacherProfile: true },
    });
    teacherId = teacher.id;
    teacherProfileId = teacher.teacherProfile!.id;
    collegeId = teacher.collegeId;
    departmentId = (
      await prisma.department.findFirstOrThrow({ where: { collegeId } })
    ).id;

    app.get(LoginRateLimiterService).reset();
    const login = await http.post('/api/v1/auth/login').send({
      email: 'teacher@campusos.dev',
      password: DEMO_PASSWORD,
    });
    expect(login.status).toBe(200);
    teacherToken = login.body.data.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('holds the owning Term FOR SHARE through the protected grade update', async () => {
    const f = await freshFixture();
    try {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      class Rollback extends Error {}

      // EXCLUSIVE allows the preflight read, then parks the authoritative
      // Submission FOR UPDATE while the grading transaction remains open.
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
            .patch(`/api/v1/submissions/${f.submissionId}/grade`)
            .set(auth())
            .send({ points: 84, feedback: 'authoritative grade' }))();

        await waitFor(async () => {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM pg_locks
            WHERE relation = '"Submission"'::regclass AND NOT granted`;
          return Number(rows[0].n) > 0;
        }, 'grade mutation to park');

        termBlocked = await termLockBlocked(f.termId);
        release();
        await parker;
        response = await inFlight;
      } finally {
        release();
        await parker.catch(() => undefined);
      }

      expect(termBlocked).toBe(true);
      expect(response!.status).toBe(200);
      const persisted = await prisma.submission.findUniqueOrThrow({
        where: { id: f.submissionId },
      });
      expect(persisted.points?.toString()).toBe('84');
      expect(persisted.feedback).toBe('authoritative grade');
      expect(persisted.gradedById).toBe(teacherId);
      expect(persisted.gradedAt).not.toBeNull();
      const entry = response!.body.data.entries.find(
        (row: { studentId: string }) => row.studentId === f.studentId,
      );
      expect(entry.submission.points).toBe('84');
      expect(entry.submission.feedback).toBe('authoritative grade');
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
