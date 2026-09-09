import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { RateLimiterService } from '../src/common/rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M14-W0 — P2 hardening regression.
 * P2-GUARD-1: timetable `view=section:` is an academics surface; callers
 * without any academics.read grant (guardians) are refused.
 * P2-AUTH-1: LoginRateLimiterService prunes dead buckets lazily.
 */
describe('M14-W0 — P2 hardening', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let rivalCollegeId: string;
  let childProfileId: string;
  let childSectionId: string;
  let rivalSectionId: string;
  let guardianToken: string;
  let guardianUserId: string;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());
    app.get(RateLimiterService).reset();

    const child = await prisma.studentProfile.findFirstOrThrow({
      where: { user: { email: 'student@campusos.dev' } },
    });
    childProfileId = child.id;
    collegeId = child.collegeId;

    const enrollment = await prisma.enrollment.findFirstOrThrow({
      where: { studentId: child.id, status: 'ACTIVE' },
    });
    childSectionId = enrollment.sectionId;

    // Rival college with one section (timetable data isn't needed —
    // the assertion is about authorization/tenancy, not rows).
    const rival = await prisma.college.create({
      data: { name: 'Rival W0 College', code: `RVW0-${suffix}` },
    });
    rivalCollegeId = rival.id;
    const rivalDept = await prisma.department.create({
      data: {
        college: { connect: { id: rival.id } },
        code: `RVW0D-${suffix}`,
        name: 'Rival Dept',
      },
    });
    const rivalYear = await prisma.academicYear.create({
      data: {
        college: { connect: { id: rival.id } },
        label: `RVW0 AY ${suffix}`,
        startsOn: new Date('2026-08-01'),
        endsOn: new Date('2027-06-30'),
      },
    });
    const rivalTerm = await prisma.term.create({
      data: {
        college: { connect: { id: rival.id } },
        academicYear: { connect: { id: rivalYear.id } },
        label: `RVW0 Term ${suffix}`,
        startsOn: new Date('2026-08-01'),
        endsOn: new Date('2026-12-20'),
      },
    });
    const rivalCourse = await prisma.course.create({
      data: {
        college: { connect: { id: rival.id } },
        department: { connect: { id: rivalDept.id } },
        code: `RVW0C-${suffix}`,
        title: 'Rival Course',
        credits: 3,
      },
    });
    const rivalSection = await prisma.section.create({
      data: {
        college: { connect: { id: rival.id } },
        course: { connect: { id: rivalCourse.id } },
        term: { connect: { id: rivalTerm.id } },
        name: 'R1',
        capacity: 30,
      },
    });
    rivalSectionId = rivalSection.id;

    const argon2 = await import('argon2');
    const guardian = await prisma.user.create({
      data: {
        college: { connect: { id: collegeId } },
        email: `w0g-${suffix}@campusos.dev`,
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        role: 'GUARDIAN',
        firstName: 'W0',
        lastName: 'Guardian',
        mustChangePassword: false,
      },
    });
    guardianUserId = guardian.id;
    await prisma.guardianLink.create({
      data: {
        collegeId,
        guardianUserId: guardian.id,
        studentProfileId: child.id,
        relationship: 'Parent',
      },
    });

    guardianToken = await login(guardian.email);
    adminToken = await login('admin@campusos.dev');
    teacherToken = await login('teacher@campusos.dev');
    studentToken = await login('student@campusos.dev');
  });

  afterAll(async () => {
    await prisma.guardianLink.deleteMany({ where: { guardianUserId } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: guardianUserId }, { targetId: guardianUserId }] },
    });
    await prisma.user.deleteMany({ where: { id: guardianUserId } });
    await prisma.section.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.course.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.term.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.academicYear.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.department.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.college.delete({ where: { id: rivalCollegeId } });
    await app.close();
  });

  describe('P2-GUARD-1 — timetable section view', () => {
    it('A: guardian is denied for any section: view — even the child’s own section', async () => {
      for (const id of [childSectionId, rivalSectionId, 'garbage-id']) {
        const res = await http
          .get(`/api/v1/timetable?view=section:${id}`)
          .set(auth(guardianToken));
        expect(res.status).toBe(403);
      }
    });

    it('B: guardian still reads the child’s timetable via view=student:<id>', async () => {
      const res = await http
        .get(`/api/v1/timetable?view=student:${childProfileId}`)
        .set(auth(guardianToken));
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('C: student section behavior unchanged (enrolled section readable, foreign scoped empty)', async () => {
      const enrolled = await http
        .get(`/api/v1/timetable?view=section:${childSectionId}`)
        .set(auth(studentToken));
      expect(enrolled.status).toBe(200);
      expect(enrolled.body.data.length).toBeGreaterThan(0);

      // OWN academics scope self-filters: a section the student is not
      // enrolled in yields an empty list (existing convention).
      const foreign = await http
        .get(`/api/v1/timetable?view=section:${rivalSectionId}`)
        .set(auth(studentToken));
      expect(foreign.status).toBe(200);
      expect(foreign.body.data).toHaveLength(0);
    });

    it('D: teacher and admin section views unchanged', async () => {
      for (const token of [teacherToken, adminToken]) {
        const res = await http
          .get(`/api/v1/timetable?view=section:${childSectionId}`)
          .set(auth(token));
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBeGreaterThan(0);
      }
    });

    it('E: rival-college section never leaks rows to same-college staff', async () => {
      const res = await http
        .get(`/api/v1/timetable?view=section:${rivalSectionId}`)
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0); // tenancy conjunct dominates
    });

    it('F: nonexistent section id stays safely empty for authorized callers', async () => {
      const res = await http
        .get('/api/v1/timetable?view=section:does-not-exist')
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe('P2-AUTH-1 — login limiter pruning', () => {
    it('A/B/C: expired ip + attacker-account buckets are swept; live buckets survive', () => {
      const limiter = new LoginRateLimiterService();
      const base = Date.now();
      const spy = jest.spyOn(Date, 'now');

      spy.mockReturnValue(base);
      // Attacker cycling emails/IPs: one failure per key (never blocked).
      for (let i = 0; i < 50; i += 1) {
        limiter.recordFailure(`ip-${i}`, `victim-${i}@x.dev`);
      }
      expect(limiter.bucketCount()).toBe(100); // 50 ip + 50 acct keys

      // A live bucket: enough failures to be actively blocked.
      for (let i = 0; i < 5; i += 1) {
        limiter.recordFailure('hot-ip', 'hot@x.dev');
      }
      expect(limiter.bucketCount()).toBe(102);

      // 90 seconds later: the single-failure buckets are outside the 60s
      // window; the blocked pair is still inside its 60s block (first
      // strike) — wait, blockedUntil = base + 60s, so at +90s it lapsed
      // too. Use +30s to keep it live.
      spy.mockReturnValue(base + 90_000);
      limiter.prune();
      expect(limiter.bucketCount()).toBe(0); // everything expired by +90s

      // Rebuild: live block must survive a sweep.
      spy.mockReturnValue(base + 200_000);
      for (let i = 0; i < 5; i += 1) {
        limiter.recordFailure('hot-ip', 'hot@x.dev');
      }
      spy.mockReturnValue(base + 200_000 + 30_000); // block (60s) still live
      limiter.prune();
      expect(limiter.bucketCount()).toBe(2);
      expect(() =>
        limiter.assertAllowed('hot-ip', 'hot@x.dev'),
      ).toThrow(); // D: limit still enforced after a sweep
      spy.mockRestore();
    });

    it('E/F: lazy sweep runs in-band at the 5-minute interval and never blocks legitimate logins', () => {
      const limiter = new LoginRateLimiterService();
      const base = Date.now();
      const spy = jest.spyOn(Date, 'now');

      spy.mockReturnValue(base);
      limiter.recordFailure('stale-ip', 'stale@x.dev');
      expect(limiter.bucketCount()).toBe(2);

      // Under the interval: assertAllowed does not sweep yet.
      spy.mockReturnValue(base + 4 * 60_000);
      limiter.assertAllowed('fresh-ip', 'fresh@x.dev'); // must not throw
      expect(limiter.bucketCount()).toBe(2);

      // Past the interval: the next legit attempt sweeps the dead keys
      // and is itself allowed.
      spy.mockReturnValue(base + 6 * 60_000);
      expect(() =>
        limiter.assertAllowed('fresh-ip', 'fresh@x.dev'),
      ).not.toThrow();
      expect(limiter.bucketCount()).toBe(0);

      // Successful-login cleanup unchanged.
      spy.mockReturnValue(base + 7 * 60_000);
      limiter.recordFailure('ok-ip', 'ok@x.dev');
      limiter.recordSuccess('ok@x.dev');
      expect(limiter.bucketCount()).toBe(1); // acct key gone, ip key remains
      spy.mockRestore();
    });
  });
});
