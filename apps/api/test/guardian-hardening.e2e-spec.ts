import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { RateLimiterService } from '../src/common/rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M13-W5 — guardian hardening regression.
 * Covers the two CHILD-scope gaps found in the final inspection
 * (assignment detail, section session lists) and the F2 limiter pruning.
 */
describe('M13-W5 — guardian hardening', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let childProfileId: string;
  let childSectionId: string;
  let guardianToken: string;
  let studentToken: string;
  let publishedAssignmentId: string;
  let draftAssignmentId: string;
  let unrelatedAssignmentId: string;
  let unrelatedSectionId: string;
  let guardianUserId: string;
  let linkId: string;
  const cleanupAssignmentIds: string[] = [];

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

    // The child's enrolled section that already has a published assignment.
    const published = await prisma.assignment.findFirstOrThrow({
      where: {
        publishedAt: { not: null },
        section: {
          collegeId,
          enrollments: { some: { studentId: child.id, status: 'ACTIVE' } },
        },
      },
    });
    publishedAssignmentId = published.id;
    childSectionId = published.sectionId;

    // A DRAFT assignment in the child's own section (unpublished).
    const teacher = await prisma.teacherProfile.findFirstOrThrow({
      where: { collegeId },
      include: { user: true },
    });
    const draft = await prisma.assignment.create({
      data: {
        sectionId: childSectionId,
        title: `W5 draft ${suffix}`,
        description: 'Unpublished — guardians must never see this.',
        dueAt: new Date(Date.now() + 7 * 86_400_000),
        maxPoints: '10',
        createdById: teacher.user.id,
        publishedAt: null,
      },
    });
    draftAssignmentId = draft.id;
    cleanupAssignmentIds.push(draft.id);

    // A PUBLISHED assignment in a section the child is NOT enrolled in.
    const unrelatedSection = await prisma.section.findFirstOrThrow({
      where: {
        collegeId,
        enrollments: { none: { studentId: child.id, status: 'ACTIVE' } },
      },
    });
    unrelatedSectionId = unrelatedSection.id;
    const unrelated = await prisma.assignment.create({
      data: {
        sectionId: unrelatedSection.id,
        title: `W5 unrelated ${suffix}`,
        description: 'Published, but not for this guardian’s child.',
        dueAt: new Date(Date.now() + 7 * 86_400_000),
        maxPoints: '10',
        createdById: teacher.user.id,
        publishedAt: new Date(),
      },
    });
    unrelatedAssignmentId = unrelated.id;
    cleanupAssignmentIds.push(unrelated.id);

    // Guardian linked to the child.
    const argon2 = await import('argon2');
    const guardian = await prisma.user.create({
      data: {
        college: { connect: { id: collegeId } },
        email: `w5g-${suffix}@campusos.dev`,
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        role: 'GUARDIAN',
        firstName: 'W5',
        lastName: 'Guardian',
        mustChangePassword: false,
      },
    });
    guardianUserId = guardian.id;
    const link = await prisma.guardianLink.create({
      data: {
        collegeId,
        guardianUserId: guardian.id,
        studentProfileId: child.id,
        relationship: 'Parent',
      },
    });
    linkId = link.id;

    guardianToken = await login(guardian.email);
    studentToken = await login('student@campusos.dev');
  });

  afterAll(async () => {
    await prisma.assignment.deleteMany({
      where: { id: { in: cleanupAssignmentIds } },
    });
    await prisma.guardianLink.deleteMany({
      where: { guardianUserId },
    });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: guardianUserId }, { targetId: guardianUserId }] },
    });
    await prisma.user.deleteMany({ where: { id: guardianUserId } });
    await app.close();
  });

  describe('assignment detail under CHILD scope', () => {
    it('published assignment of the linked child’s section is readable', async () => {
      const res = await http
        .get(`/api/v1/assignments/${publishedAssignmentId}`)
        .set(auth(guardianToken));
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(publishedAssignmentId);
      // Read-only view: no submission of the guardian's own exists.
      expect(res.body.data.mySubmissionContent).toBeNull();
    });

    it('DRAFT assignment in the child’s own section is invisible (404)', async () => {
      const res = await http
        .get(`/api/v1/assignments/${draftAssignmentId}`)
        .set(auth(guardianToken));
      expect(res.status).toBe(404);
    });

    it('published assignment of an unrelated section is invisible (404)', async () => {
      const res = await http
        .get(`/api/v1/assignments/${unrelatedAssignmentId}`)
        .set(auth(guardianToken));
      expect(res.status).toBe(404);
    });

    it('revocation kills detail access immediately; student OWN unaffected', async () => {
      await prisma.guardianLink.update({
        where: { id: linkId },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      try {
        const res = await http
          .get(`/api/v1/assignments/${publishedAssignmentId}`)
          .set(auth(guardianToken));
        expect(res.status).toBe(404);
      } finally {
        await prisma.guardianLink.update({
          where: { id: linkId },
          data: { status: 'ACTIVE', revokedAt: null },
        });
      }
      const own = await http
        .get(`/api/v1/assignments/${publishedAssignmentId}`)
        .set(auth(studentToken));
      expect(own.status).toBe(200);
    });
  });

  describe('section session lists under CHILD scope', () => {
    it('guardian is refused even for the child’s own section; student stays allowed', async () => {
      const denied = await http
        .get(`/api/v1/sections/${childSectionId}/sessions`)
        .set(auth(guardianToken));
      expect(denied.status).toBe(403);

      const deniedUnrelated = await http
        .get(`/api/v1/sections/${unrelatedSectionId}/sessions`)
        .set(auth(guardianToken));
      expect(deniedUnrelated.status).toBe(403);

      const allowed = await http
        .get(`/api/v1/sections/${childSectionId}/sessions`)
        .set(auth(studentToken));
      expect(allowed.status).toBe(200);
    });
  });

  describe('F2 — rate limiter bucket pruning', () => {
    it('expired buckets are swept; live buckets and limits survive', () => {
      const limiter = new RateLimiterService();
      const base = Date.now();
      const spy = jest.spyOn(Date, 'now');

      spy.mockReturnValue(base);
      limiter.assert('inviteInfo', 'ip-1'); // 60s window
      limiter.assert('inviteInfo', 'ip-2');
      limiter.assert('guardianInvite', 'admin-1'); // 1h window
      expect(limiter.bucketCount()).toBe(3);

      // 10 minutes later: the 60s inviteInfo buckets are fully expired,
      // the 1h guardianInvite bucket is still live.
      spy.mockReturnValue(base + 10 * 60_000);
      limiter.prune();
      expect(limiter.bucketCount()).toBe(1);

      // The surviving bucket still counts toward its limit.
      for (let i = 0; i < 19; i += 1) {
        limiter.assert('guardianInvite', 'admin-1');
      }
      expect(() => limiter.assert('guardianInvite', 'admin-1')).toThrow();

      // Beyond every window: everything is swept.
      spy.mockReturnValue(base + 2 * 60 * 60_000);
      limiter.prune();
      expect(limiter.bucketCount()).toBe(0);
      spy.mockRestore();
    });

    it('pruning happens lazily via assert() after the interval', () => {
      const limiter = new RateLimiterService();
      const base = Date.now();
      const spy = jest.spyOn(Date, 'now');

      spy.mockReturnValue(base);
      limiter.assert('inviteInfo', 'stale-ip');
      // Just under the prune interval: stale bucket survives (no sweep yet).
      spy.mockReturnValue(base + 4 * 60_000);
      limiter.assert('inviteInfo', 'fresh-ip');
      expect(limiter.bucketCount()).toBe(2);
      // Past the interval: the next assert sweeps both expired keys
      // (stale-ip and fresh-ip are outside the 60s window by +6m),
      // leaving only the key being asserted right now.
      spy.mockReturnValue(base + 6 * 60_000);
      limiter.assert('inviteInfo', 'fresh-ip-2');
      expect(limiter.bucketCount()).toBe(1);
      spy.mockRestore();
    });
  });
});
