import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { NotificationSchedulerService } from '../src/notifications/notification-scheduler.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';
const ADMIN = 'admin@campusos.dev';
const TEACHER = 'teacher@campusos.dev';
const STUDENT = 'student@campusos.dev';
const STUDENT2 = 'jonas.weber@campusos.dev';

const flush = () => new Promise((resolve) => setTimeout(resolve, 300));

describe('M8 — Moderation, Notifications & Announcements', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let scheduler: NotificationSchedulerService;
  let http: ReturnType<typeof request>;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  let student2Token: string;
  const suffix = Date.now().toString(36).toUpperCase();
  const cleanups: Array<() => Promise<unknown>> = [];
  let studentUserId: string;
  let student2UserId: string;
  let postId: string;
  let reportId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    scheduler = app.get(NotificationSchedulerService);
    app.get(LoginRateLimiterService).reset();
    http = request(app.getHttpServer());

    const token = async (email: string) => {
      const res = await http
        .post('/api/v1/auth/login')
        .send({ email, password: DEMO_PASSWORD });
      expect(res.status).toBe(200);
      return res.body.data.accessToken as string;
    };
    adminToken = await token(ADMIN);
    teacherToken = await token(TEACHER);
    studentToken = await token(STUDENT);
    student2Token = await token(STUDENT2);

    studentUserId = (
      await prisma.user.findFirstOrThrow({ where: { email: STUDENT } })
    ).id;
    student2UserId = (
      await prisma.user.findFirstOrThrow({ where: { email: STUDENT2 } })
    ).id;

    // Fixture post authored by student2 that student reports.
    const post = await http
      .post('/api/v1/community/posts')
      .set({ Authorization: `Bearer ${student2Token}` })
      .send({ body: `Report me ${suffix}` });
    postId = post.body.data.id;

    cleanups.push(async () => {
      await prisma.moderationAction.deleteMany({
        where: { targetId: postId },
      });
      await prisma.moderationAction.deleteMany({
        where: { targetUserId: student2UserId, note: { contains: suffix } },
      });
      await prisma.report.deleteMany({
        where: { targetId: postId },
      });
      await prisma.post.deleteMany({ where: { body: { contains: suffix } } });
      await prisma.announcement.deleteMany({
        where: { title: { contains: suffix } },
      });
      await prisma.notification.deleteMany({
        where: {
          OR: [
            { title: { contains: suffix } },
            { body: { contains: suffix } },
            {
              type: {
                in: [
                  'moderation.action_taken',
                  'announcement.published',
                  'assignment.due_soon',
                  'invoice.overdue',
                  'event.reminder',
                ],
              },
              createdAt: { gt: new Date(Date.now() - 10 * 60 * 1000) },
            },
          ],
        },
      });
    });
  });

  afterAll(async () => {
    for (const cleanup of cleanups.reverse()) {
      await cleanup().catch(() => undefined);
    }
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  // ── Reporting ──────────────────────────────────────────────

  it('any participant can report; duplicates by the same reporter are rejected; invalid targets rejected', async () => {
    const created = await http
      .post('/api/v1/community/reports')
      .set(auth(studentToken))
      .send({ targetType: 'POST', targetId: postId, reason: 'SPAM', details: `s ${suffix}` });
    expect(created.status).toBe(201);
    reportId = created.body.data.id;

    const duplicate = await http
      .post('/api/v1/community/reports')
      .set(auth(studentToken))
      .send({ targetType: 'POST', targetId: postId, reason: 'OTHER' });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error.code).toBe('ALREADY_REPORTED');

    // A second reporter creates a second report → grouped count of 2.
    const second = await http
      .post('/api/v1/community/reports')
      .set(auth(teacherToken))
      .send({ targetType: 'POST', targetId: postId, reason: 'HARASSMENT' });
    expect(second.status).toBe(201);
    expect(second.body.data.reportCountForTarget).toBe(2);

    const invalid = await http
      .post('/api/v1/community/reports')
      .set(auth(studentToken))
      .send({ targetType: 'POST', targetId: 'nonexistent', reason: 'SPAM' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('INVALID_TARGET');
  });

  it('the moderation queue is admin-only and renders the target in context', async () => {
    for (const t of [teacherToken, studentToken]) {
      const denied = await http.get('/api/v1/moderation/reports').set(auth(t));
      expect(denied.status).toBe(403);
    }
    const list = await http
      .get('/api/v1/moderation/reports?status=OPEN&limit=100')
      .set(auth(adminToken));
    expect(list.status).toBe(200);
    expect(
      (list.body.data as Array<{ id: string }>).some((r) => r.id === reportId),
    ).toBe(true);

    const detail = await http
      .get(`/api/v1/moderation/reports/${reportId}`)
      .set(auth(adminToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.target.body).toBe(`Report me ${suffix}`);
    expect(detail.body.data.target.authorUserId).toBe(student2UserId);
  });

  it('REMOVE_CONTENT hides the post, notifies the author, and resolves the report; RESTORE reverses it', async () => {
    const before = await prisma.notification.count({
      where: { userId: student2UserId, type: 'moderation.action_taken' },
    });
    const removed = await http
      .post('/api/v1/moderation/actions')
      .set(auth(adminToken))
      .send({
        reportId,
        action: 'REMOVE_CONTENT',
        targetType: 'POST',
        targetId: postId,
        note: `Rule 3 ${suffix}`,
      });
    expect(removed.status).toBe(201);
    expect(removed.body.data.status).toBe('RESOLVED');

    const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
    expect(post.status).toBe('REMOVED_BY_MODERATOR');

    await flush();
    const after = await prisma.notification.count({
      where: { userId: student2UserId, type: 'moderation.action_taken' },
    });
    expect(after).toBe(before + 1);

    const restored = await http
      .post('/api/v1/moderation/actions')
      .set(auth(adminToken))
      .send({ action: 'RESTORE_CONTENT', targetType: 'POST', targetId: postId });
    expect(restored.status).toBe(201);
    const postAfter = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
    expect(postAfter.status).toBe('ACTIVE');
  });

  it('SUSPEND blocks participation; LIFT restores; admins are immune', async () => {
    const suspend = await http
      .post('/api/v1/moderation/actions')
      .set(auth(adminToken))
      .send({
        action: 'SUSPEND_COMMUNITY',
        targetType: 'USER',
        targetId: student2UserId,
        targetUserId: student2UserId,
        expiresInDays: 7,
        note: `suspension ${suffix}`,
      });
    expect(suspend.status).toBe(201);

    const blocked = await http
      .post('/api/v1/community/posts')
      .set(auth(student2Token))
      .send({ body: `blocked ${suffix}` });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('COMMUNITY_SUSPENDED');

    const lift = await http
      .post('/api/v1/moderation/actions')
      .set(auth(adminToken))
      .send({
        action: 'LIFT_SUSPENSION',
        targetType: 'USER',
        targetId: student2UserId,
        targetUserId: student2UserId,
        note: `lifted ${suffix}`,
      });
    expect(lift.status).toBe(201);

    const unblocked = await http
      .post('/api/v1/community/posts')
      .set(auth(student2Token))
      .send({ body: `free again ${suffix}` });
    expect(unblocked.status).toBe(201);

    // Admin immunity: the target role holds moderation.act.
    const adminUser = await prisma.user.findFirstOrThrow({ where: { email: ADMIN } });
    const immune = await http
      .post('/api/v1/moderation/actions')
      .set(auth(adminToken))
      .send({
        action: 'SUSPEND_COMMUNITY',
        targetType: 'USER',
        targetId: adminUser.id,
        targetUserId: adminUser.id,
      });
    expect(immune.status).toBe(400);
    expect(immune.body.error.code).toBe('TARGET_IMMUNE');
  });

  it('dismissing a report records resolution', async () => {
    const extra = await http
      .post('/api/v1/community/reports')
      .set(auth(student2Token))
      .send({ targetType: 'USER', targetId: studentUserId, reason: 'OTHER', details: `d ${suffix}` });
    expect(extra.status).toBe(201);
    const dismissed = await http
      .patch(`/api/v1/moderation/reports/${extra.body.data.id}`)
      .set(auth(adminToken))
      .send({ status: 'DISMISSED', resolutionNote: 'No violation.' });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.data.status).toBe('DISMISSED');
    expect(dismissed.body.data.resolvedByName).toBeTruthy();
    cleanups.push(() =>
      prisma.report.deleteMany({ where: { id: extra.body.data.id } }),
    );
  });

  // ── Notification inbox ─────────────────────────────────────

  it('inbox is self-scoped with unread filter, mark-read and read-all', async () => {
    const list = await http
      .get('/api/v1/notifications?limit=100')
      .set(auth(student2Token));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);

    const unreadOnly = await http
      .get('/api/v1/notifications?unread=true&limit=100')
      .set(auth(student2Token));
    expect(
      (unreadOnly.body.data as Array<{ readAt: string | null }>).every(
        (n) => n.readAt === null,
      ),
    ).toBe(true);

    const target = unreadOnly.body.data[0];
    const marked = await http
      .patch(`/api/v1/notifications/${target.id}/read`)
      .set(auth(student2Token));
    expect(marked.status).toBe(200);
    const row = await prisma.notification.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(row.readAt).not.toBeNull();

    // Another user cannot mark someone else's notification.
    const foreign = await http
      .patch(`/api/v1/notifications/${target.id}/read`)
      .set(auth(studentToken));
    expect(foreign.status).toBe(200); // no-op — scoped updateMany matches 0 rows
    const still = await prisma.notification.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(still.userId).toBe(student2UserId);

    const readAll = await http
      .post('/api/v1/notifications/read-all')
      .set(auth(student2Token));
    expect(readAll.status).toBe(201);
    const count = await http
      .get('/api/v1/notifications/unread-count')
      .set(auth(student2Token));
    expect(count.body.data.unread).toBe(0);
  });

  // ── Announcements ──────────────────────────────────────────

  it('admin ALL announcement fans out to everyone except the author', async () => {
    const before = await prisma.notification.count({
      where: { userId: studentUserId, type: 'announcement.published' },
    });
    const created = await http
      .post('/api/v1/announcements')
      .set(auth(adminToken))
      .send({
        title: `Campus notice ${suffix}`,
        body: 'All-hands announcement.',
        audienceScope: 'ALL',
        audienceIds: [],
      });
    expect(created.status).toBe(201);

    await flush();
    const after = await prisma.notification.count({
      where: { userId: studentUserId, type: 'announcement.published' },
    });
    expect(after).toBe(before + 1);

    const visible = await http
      .get('/api/v1/announcements?limit=100')
      .set(auth(studentToken));
    expect(
      (visible.body.data as Array<{ title: string }>).some(
        (a) => a.title === `Campus notice ${suffix}`,
      ),
    ).toBe(true);
  });

  it('teachers announce only to their own sections; students cannot announce', async () => {
    const ownSection = await prisma.section.findFirstOrThrow({
      where: {
        teachingAssignments: { some: { teacher: { user: { email: TEACHER } } } },
      },
    });
    const foreignSection = await prisma.section.findFirstOrThrow({
      where: {
        teachingAssignments: { none: { teacher: { user: { email: TEACHER } } } },
      },
    });

    const allDenied = await http
      .post('/api/v1/announcements')
      .set(auth(teacherToken))
      .send({
        title: `Teacher ALL ${suffix}`,
        body: 'x',
        audienceScope: 'ALL',
        audienceIds: [],
      });
    expect(allDenied.status).toBe(403);

    const foreignDenied = await http
      .post('/api/v1/announcements')
      .set(auth(teacherToken))
      .send({
        title: `Foreign section ${suffix}`,
        body: 'x',
        audienceScope: 'SECTION',
        audienceIds: [foreignSection.id],
      });
    expect(foreignDenied.status).toBe(403);

    const ok = await http
      .post('/api/v1/announcements')
      .set(auth(teacherToken))
      .send({
        title: `Section notice ${suffix}`,
        body: 'Quiz moved to Friday.',
        audienceScope: 'SECTION',
        audienceIds: [ownSection.id],
      });
    expect(ok.status).toBe(201);

    const studentDenied = await http
      .post('/api/v1/announcements')
      .set(auth(studentToken))
      .send({
        title: `Student ann ${suffix}`,
        body: 'x',
        audienceScope: 'ALL',
        audienceIds: [],
      });
    expect(studentDenied.status).toBe(403);
  });

  it('section announcements are visible only to the section audience', async () => {
    // The demo student is in CS-101/A which the demo teacher teaches, so she
    // should see the section notice; a BUS-only student should not.
    const visible = await http
      .get('/api/v1/announcements?limit=100')
      .set(auth(studentToken));
    expect(
      (visible.body.data as Array<{ title: string }>).some(
        (a) => a.title === `Section notice ${suffix}`,
      ),
    ).toBe(true);

    const busToken = await (async () => {
      const res = await http
        .post('/api/v1/auth/login')
        .send({ email: 'ali.demir@campusos.dev', password: DEMO_PASSWORD });
      return res.body.data.accessToken as string;
    })();
    const hidden = await http
      .get('/api/v1/announcements?limit=100')
      .set(auth(busToken));
    expect(
      (hidden.body.data as Array<{ title: string }>).some(
        (a) => a.title === `Section notice ${suffix}`,
      ),
    ).toBe(false);
  });

  // ── Scheduled sweeps ───────────────────────────────────────

  it('due-soon sweep notifies unsubmitted students once (idempotent)', async () => {
    const teacherUser = await prisma.user.findFirstOrThrow({ where: { email: TEACHER } });
    const section = await prisma.section.findFirstOrThrow({
      where: {
        enrollments: { some: { student: { userId: studentUserId }, status: 'ACTIVE' } },
        teachingAssignments: { some: { teacher: { userId: teacherUser.id } } },
      },
    });
    const assignment = await prisma.assignment.create({
      data: {
        sectionId: section.id,
        title: `Due soon ${suffix}`,
        description: 'x',
        dueAt: new Date(Date.now() + 6 * 3600000),
        maxPoints: 10,
        createdById: teacherUser.id,
        publishedAt: new Date(),
      },
    });
    cleanups.push(() =>
      prisma.assignment.deleteMany({ where: { id: assignment.id } }),
    );

    await scheduler.sweepDueSoonAssignments();
    await flush();
    const first = await prisma.notification.count({
      where: {
        userId: studentUserId,
        type: 'assignment.due_soon',
        linkPath: `/assignments/${assignment.id}`,
      },
    });
    expect(first).toBe(1);

    await scheduler.sweepDueSoonAssignments();
    await flush();
    const second = await prisma.notification.count({
      where: {
        userId: studentUserId,
        type: 'assignment.due_soon',
        linkPath: `/assignments/${assignment.id}`,
      },
    });
    expect(second).toBe(1); // idempotent
  });

  it('overdue sweep transitions and notifies once; event reminder reaches RSVPs once', async () => {
    // Overdue invoice fixture.
    const college = await prisma.college.findFirstOrThrow({ where: { code: 'CAMPUS-01' } });
    const structure = await prisma.feeStructure.findFirstOrThrow({
      where: { collegeId: college.id },
    });
    const studentProfile = await prisma.studentProfile.findFirstOrThrow({
      where: { userId: studentUserId },
    });
    const invoice = await prisma.invoice.create({
      data: {
        collegeId: college.id,
        studentId: studentProfile.id,
        structureId: structure.id,
        invoiceNo: `INV-M8-${suffix}`,
        amount: 100,
        dueDate: new Date(Date.now() - 86400000),
        status: 'PENDING',
      },
    });
    cleanups.push(() => prisma.invoice.deleteMany({ where: { id: invoice.id } }));

    await scheduler.sweepOverdueInvoices();
    await flush();
    const overdueRow = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(overdueRow.status).toBe('OVERDUE');
    const overdueCount = async () =>
      prisma.notification.count({
        where: {
          userId: studentUserId,
          type: 'invoice.overdue',
          linkPath: `/fees/invoices/${invoice.id}`,
        },
      });
    expect(await overdueCount()).toBe(1);
    await scheduler.sweepOverdueInvoices();
    await flush();
    expect(await overdueCount()).toBe(1);

    // Event reminder fixture.
    const adminUser = await prisma.user.findFirstOrThrow({ where: { email: ADMIN } });
    const event = await prisma.event.create({
      data: {
        collegeId: college.id,
        title: `Soon event ${suffix}`,
        description: 'x',
        venue: 'Quad',
        startsAt: new Date(Date.now() + 3 * 3600000),
        endsAt: new Date(Date.now() + 5 * 3600000),
        createdById: adminUser.id,
      },
    });
    await prisma.eventRsvp.create({
      data: { eventId: event.id, userId: studentUserId, status: 'GOING' },
    });
    cleanups.push(async () => {
      await prisma.eventRsvp.deleteMany({ where: { eventId: event.id } });
      await prisma.event.deleteMany({ where: { id: event.id } });
    });

    await scheduler.sweepEventReminders();
    await flush();
    const reminderCount = async () =>
      prisma.notification.count({
        where: {
          userId: studentUserId,
          type: 'event.reminder',
          linkPath: `/community/events?event=${event.id}`,
        },
      });
    expect(await reminderCount()).toBe(1);
    await scheduler.sweepEventReminders();
    await flush();
    expect(await reminderCount()).toBe(1);
  });

  // ── Tenant isolation & auth ────────────────────────────────

  it('tenant isolation: reports/announcements from other colleges are invisible', async () => {
    const rival = await prisma.college.create({
      data: { name: 'Rival8', code: `RIVAL8-${suffix}` },
    });
    const rivalUser = await prisma.user.create({
      data: {
        collegeId: rival.id,
        email: `rival8-${suffix}@rival.dev`.toLowerCase(),
        passwordHash: 'x',
        role: 'ADMIN',
        firstName: 'R',
        lastName: 'A',
      },
    });
    const rivalReport = await prisma.report.create({
      data: {
        collegeId: rival.id,
        reporterId: rivalUser.id,
        targetType: 'USER',
        targetId: rivalUser.id,
        reason: 'OTHER',
      },
    });
    cleanups.push(async () => {
      await prisma.report.delete({ where: { id: rivalReport.id } });
      await prisma.user.delete({ where: { id: rivalUser.id } });
      await prisma.college.delete({ where: { id: rival.id } });
    });

    const detail = await http
      .get(`/api/v1/moderation/reports/${rivalReport.id}`)
      .set(auth(adminToken));
    expect(detail.status).toBe(404);
  });

  it('unauthenticated requests are rejected on M8 surfaces', async () => {
    for (const path of [
      '/api/v1/notifications',
      '/api/v1/notifications/unread-count',
      '/api/v1/moderation/reports',
      '/api/v1/announcements',
    ]) {
      const res = await http.get(path);
      expect(res.status).toBe(401);
    }
  });
});
