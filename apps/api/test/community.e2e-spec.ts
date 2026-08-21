import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';
const ADMIN = 'admin@campusos.dev';
const TEACHER = 'teacher@campusos.dev';
const STUDENT = 'student@campusos.dev';
const STUDENT2 = 'jonas.weber@campusos.dev';

const flush = () => new Promise((resolve) => setTimeout(resolve, 300));

describe('M7 — Community', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  let student2Token: string;
  const suffix = Date.now().toString(36).toUpperCase();
  const cleanups: Array<() => Promise<unknown>> = [];
  let studentUserId: string;
  let student2UserId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
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

    cleanups.push(async () => {
      await prisma.like.deleteMany({
        where: { post: { body: { contains: suffix } } },
      });
      await prisma.comment.deleteMany({
        where: { post: { body: { contains: suffix } } },
      });
      await prisma.post.deleteMany({ where: { body: { contains: suffix } } });
      await prisma.groupMember.deleteMany({
        where: { group: { name: { contains: suffix } } },
      });
      await prisma.group.deleteMany({ where: { name: { contains: suffix } } });
      await prisma.eventRsvp.deleteMany({
        where: { event: { title: { contains: suffix } } },
      });
      await prisma.event.deleteMany({ where: { title: { contains: suffix } } });
      await prisma.societyMember.deleteMany({
        where: { society: { name: { contains: suffix } } },
      });
      await prisma.society.deleteMany({ where: { name: { contains: suffix } } });
      await prisma.resource.deleteMany({ where: { title: { contains: suffix } } });
      await prisma.moderationAction.deleteMany({
        where: { note: { contains: suffix } },
      });
      await prisma.notification.deleteMany({
        where: {
          type: {
            in: [
              'community.comment',
              'community.like',
              'community.group_request',
              'community.membership_decided',
              'event.created',
            ],
          },
          userId: { in: [studentUserId, student2UserId] },
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

  // ── Posts, comments, likes ─────────────────────────────────

  let postId: string;

  it('student creates a campus post; feed shows it', async () => {
    const created = await http
      .post('/api/v1/community/posts')
      .set(auth(studentToken))
      .send({ body: `Hello campus ${suffix}`, type: 'GENERAL' });
    expect(created.status).toBe(201);
    postId = created.body.data.id;

    const feed = await http
      .get('/api/v1/community/posts?limit=50')
      .set(auth(student2Token));
    expect(feed.status).toBe(200);
    expect(
      (feed.body.data as Array<{ id: string }>).some((p) => p.id === postId),
    ).toBe(true);
  });

  it('comment increments counter + notifies the author (not self-comments)', async () => {
    const before = await prisma.notification.count({
      where: { userId: studentUserId, type: 'community.comment' },
    });
    const res = await http
      .post(`/api/v1/community/posts/${postId}/comments`)
      .set(auth(student2Token))
      .send({ body: `Nice one ${suffix}` });
    expect(res.status).toBe(201);
    const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
    expect(post.commentCount).toBe(1);

    await flush();
    const after = await prisma.notification.count({
      where: { userId: studentUserId, type: 'community.comment' },
    });
    expect(after).toBe(before + 1);
  });

  it('likes are idempotent, unlike works, self-likes never notify twice within an hour', async () => {
    const first = await http
      .put(`/api/v1/community/posts/${postId}/like`)
      .set(auth(student2Token));
    expect(first.status).toBe(200);
    expect(first.body.data.likeCount).toBe(1);

    const second = await http
      .put(`/api/v1/community/posts/${postId}/like`)
      .set(auth(student2Token));
    expect(second.body.data.likeCount).toBe(1); // idempotent

    await flush();
    const likeNotifications = await prisma.notification.count({
      where: { userId: studentUserId, type: 'community.like' },
    });
    expect(likeNotifications).toBe(1); // collapsed

    const unliked = await http
      .delete(`/api/v1/community/posts/${postId}/like`)
      .set(auth(student2Token));
    expect(unliked.body.data.likeCount).toBe(0);
  });

  it('only the author edits/deletes their post; delete shows as removed', async () => {
    const foreignEdit = await http
      .patch(`/api/v1/community/posts/${postId}`)
      .set(auth(student2Token))
      .send({ body: 'hijack' });
    expect(foreignEdit.status).toBe(403);
    const foreignDelete = await http
      .delete(`/api/v1/community/posts/${postId}`)
      .set(auth(student2Token));
    expect(foreignDelete.status).toBe(403);

    const edit = await http
      .patch(`/api/v1/community/posts/${postId}`)
      .set(auth(studentToken))
      .send({ body: `Hello campus (edited) ${suffix}` });
    expect(edit.status).toBe(200);

    const removed = await http
      .delete(`/api/v1/community/posts/${postId}`)
      .set(auth(studentToken));
    expect(removed.status).toBe(200);
    const row = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
    expect(row.status).toBe('REMOVED_BY_AUTHOR');
  });

  // ── Suspension gate ────────────────────────────────────────

  it('a SUSPEND_COMMUNITY moderation action blocks participation until lifted', async () => {
    const college = await prisma.college.findFirstOrThrow({
      where: { code: 'CAMPUS-01' },
    });
    const adminUser = await prisma.user.findFirstOrThrow({ where: { email: ADMIN } });
    const suspension = await prisma.moderationAction.create({
      data: {
        collegeId: college.id,
        actorId: adminUser.id,
        action: 'SUSPEND_COMMUNITY',
        targetType: 'USER',
        targetId: student2UserId,
        targetUserId: student2UserId,
        note: `test ${suffix}`,
      },
    });

    const blocked = await http
      .post('/api/v1/community/posts')
      .set(auth(student2Token))
      .send({ body: `Should fail ${suffix}` });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('COMMUNITY_SUSPENDED');

    await prisma.moderationAction.create({
      data: {
        collegeId: college.id,
        actorId: adminUser.id,
        action: 'LIFT_SUSPENSION',
        targetType: 'USER',
        targetId: student2UserId,
        targetUserId: student2UserId,
        note: `test ${suffix}`,
        createdAt: new Date(suspension.createdAt.getTime() + 1000),
      },
    });
    const unblocked = await http
      .post('/api/v1/community/posts')
      .set(auth(student2Token))
      .send({ body: `Back again ${suffix}` });
    expect(unblocked.status).toBe(201);
  });

  // ── Groups ─────────────────────────────────────────────────

  let openGroupId: string;
  let requestGroupId: string;

  it('creator becomes moderator; duplicate names rejected', async () => {
    const created = await http
      .post('/api/v1/community/groups')
      .set(auth(studentToken))
      .send({ name: `Chess ${suffix}`, description: 'Casual games', privacy: 'OPEN' });
    expect(created.status).toBe(201);
    expect(created.body.data.myMembership.role).toBe('MODERATOR');
    openGroupId = created.body.data.id;

    const dup = await http
      .post('/api/v1/community/groups')
      .set(auth(student2Token))
      .send({ name: `Chess ${suffix}`, description: 'x', privacy: 'OPEN' });
    expect(dup.status).toBe(400);
    expect(dup.body.error.code).toBe('DUPLICATE_GROUP_NAME');
  });

  it('OPEN join is immediate; REQUEST join is PENDING until approved; non-members cannot post or view', async () => {
    const joined = await http
      .post(`/api/v1/community/groups/${openGroupId}/membership`)
      .set(auth(student2Token));
    expect(joined.status).toBe(201);
    const again = await http
      .post(`/api/v1/community/groups/${openGroupId}/membership`)
      .set(auth(student2Token));
    expect(again.status).toBe(409);

    const requestGroup = await http
      .post('/api/v1/community/groups')
      .set(auth(studentToken))
      .send({ name: `Private ${suffix}`, description: 'x', privacy: 'REQUEST' });
    requestGroupId = requestGroup.body.data.id;

    const request2 = await http
      .post(`/api/v1/community/groups/${requestGroupId}/membership`)
      .set(auth(student2Token));
    expect(request2.status).toBe(201);
    const detail = await http
      .get(`/api/v1/community/groups/${requestGroupId}`)
      .set(auth(studentToken));
    const pending = detail.body.data.members.find(
      (m: { userId: string }) => m.userId === student2UserId,
    );
    expect(pending.status).toBe('PENDING');

    // Pending members cannot post or view the wall.
    const post = await http
      .post('/api/v1/community/posts')
      .set(auth(student2Token))
      .send({ body: `sneak ${suffix}`, groupId: requestGroupId });
    expect(post.status).toBe(403);
    const wall = await http
      .get(`/api/v1/community/posts?groupId=${requestGroupId}`)
      .set(auth(student2Token));
    expect(wall.status).toBe(403);

    // Teacher (non-moderator) cannot approve; the moderator can.
    const teacherApprove = await http
      .patch(
        `/api/v1/community/groups/${requestGroupId}/membership/${student2UserId}/approve`,
      )
      .set(auth(teacherToken));
    expect(teacherApprove.status).toBe(403);

    const approve = await http
      .patch(
        `/api/v1/community/groups/${requestGroupId}/membership/${student2UserId}/approve`,
      )
      .set(auth(studentToken));
    expect(approve.status).toBe(200);

    const postAfter = await http
      .post('/api/v1/community/posts')
      .set(auth(student2Token))
      .send({ body: `member now ${suffix}`, groupId: requestGroupId });
    expect(postAfter.status).toBe(201);

    await flush();
    const decided = await prisma.notification.count({
      where: { userId: student2UserId, type: 'community.membership_decided' },
    });
    expect(decided).toBeGreaterThanOrEqual(1);
  });

  it('the last moderator cannot leave their group', async () => {
    const res = await http
      .delete(`/api/v1/community/groups/${openGroupId}/membership`)
      .set(auth(studentToken));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LAST_MODERATOR');
  });

  // ── Societies ──────────────────────────────────────────────

  let societyId: string;

  it('only admins charter societies; officers manage members', async () => {
    const denied = await http
      .post('/api/v1/community/societies')
      .set(auth(studentToken))
      .send({ name: `Robotics ${suffix}`, category: 'TECHNICAL', description: 'x' });
    expect(denied.status).toBe(403);

    const created = await http
      .post('/api/v1/community/societies')
      .set(auth(adminToken))
      .send({ name: `Robotics ${suffix}`, category: 'TECHNICAL', description: 'Bots.' });
    expect(created.status).toBe(201);
    societyId = created.body.data.id;

    // Admin appoints the demo student as president.
    const president = await http
      .post(`/api/v1/community/societies/${societyId}/members`)
      .set(auth(adminToken))
      .send({ userId: studentUserId, role: 'PRESIDENT' });
    expect(president.status).toBe(201);

    // The president (a student) can now add members…
    const addMember = await http
      .post(`/api/v1/community/societies/${societyId}/members`)
      .set(auth(studentToken))
      .send({ userId: student2UserId, role: 'MEMBER' });
    expect(addMember.status).toBe(201);

    // …but a plain member cannot.
    const memberAdd = await http
      .post(`/api/v1/community/societies/${societyId}/members`)
      .set(auth(student2Token))
      .send({ userId: student2UserId, role: 'OFFICER' });
    expect(memberAdd.status).toBe(403);
  });

  it('society wall posts are officers-only', async () => {
    const memberPost = await http
      .post('/api/v1/community/posts')
      .set(auth(student2Token))
      .send({ body: `wall ${suffix}`, societyId });
    expect(memberPost.status).toBe(403);

    const presidentPost = await http
      .post('/api/v1/community/posts')
      .set(auth(studentToken))
      .send({ body: `official update ${suffix}`, societyId });
    expect(presidentPost.status).toBe(201);
  });

  // ── Events & RSVP ──────────────────────────────────────────

  it('society officers create society events; plain students cannot create campus events; RSVP upserts; capacity enforced', async () => {
    const campusDenied = await http
      .post('/api/v1/community/events')
      .set(auth(student2Token))
      .send({
        title: `Rogue event ${suffix}`,
        description: 'x',
        venue: 'Quad',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 90000000).toISOString(),
      });
    expect(campusDenied.status).toBe(403);

    const created = await http
      .post('/api/v1/community/events')
      .set(auth(studentToken)) // president of the fixture society
      .send({
        societyId,
        title: `Robot Demo ${suffix}`,
        description: 'Show and tell.',
        venue: 'Lab 2',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 90000000).toISOString(),
        capacity: 1,
      });
    expect(created.status).toBe(201);
    const eventId = created.body.data.id;

    const going = await http
      .put(`/api/v1/community/events/${eventId}/rsvp`)
      .set(auth(student2Token))
      .send({ status: 'GOING' });
    expect(going.status).toBe(200);

    // Capacity 1 is now full for a different user.
    const full = await http
      .put(`/api/v1/community/events/${eventId}/rsvp`)
      .set(auth(teacherToken))
      .send({ status: 'GOING' });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('EVENT_FULL');

    // The same user can change their RSVP (upsert).
    const changed = await http
      .put(`/api/v1/community/events/${eventId}/rsvp`)
      .set(auth(student2Token))
      .send({ status: 'INTERESTED' });
    expect(changed.status).toBe(200);
    expect(changed.body.data.myRsvp).toBe('INTERESTED');

    // Teachers can create campus-wide events (matrix grant).
    const teacherEvent = await http
      .post('/api/v1/community/events')
      .set(auth(teacherToken))
      .send({
        title: `Guest Lecture ${suffix}`,
        description: 'Industry talk.',
        venue: 'Auditorium',
        startsAt: new Date(Date.now() + 2 * 86400000).toISOString(),
        endsAt: new Date(Date.now() + 2 * 86400000 + 7200000).toISOString(),
      });
    expect(teacherEvent.status).toBe(201);
  });

  // ── Resources ──────────────────────────────────────────────

  it('resource upload → share → download increments the counter', async () => {
    const upload = await http
      .post('/api/v1/files')
      .set(auth(studentToken))
      .attach('file', Buffer.from('lecture notes', 'utf8'), 'notes.txt');
    expect(upload.status).toBe(201);

    const created = await http
      .post('/api/v1/community/resources')
      .set(auth(studentToken))
      .send({
        title: `CS-101 Notes ${suffix}`,
        description: 'Week 1–3 condensed.',
        fileUrl: upload.body.data.url,
        fileName: upload.body.data.name,
        fileSize: upload.body.data.size,
      });
    expect(created.status).toBe(201);
    const resourceId = created.body.data.id;

    const download = await http
      .get(`/api/v1/community/resources/${resourceId}/download`)
      .set(auth(student2Token));
    expect(download.status).toBe(200);
    expect(download.body.data.url).toBe(upload.body.data.url);

    const row = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
    expect(row.downloadCount).toBe(1);
  });

  // ── Tenant isolation & auth ─────────────────────────────────

  it('tenant isolation: other-college groups/posts are invisible', async () => {
    const rival = await prisma.college.create({
      data: { name: 'Rival7', code: `RIVAL7-${suffix}` },
    });
    const rivalUser = await prisma.user.create({
      data: {
        collegeId: rival.id,
        email: `rival7-${suffix}@rival.dev`.toLowerCase(),
        passwordHash: 'x',
        role: 'ADMIN',
        firstName: 'R',
        lastName: 'A',
      },
    });
    const rivalGroup = await prisma.group.create({
      data: {
        collegeId: rival.id,
        name: 'Rival group',
        description: 'x',
        createdById: rivalUser.id,
      },
    });
    cleanups.push(async () => {
      await prisma.group.delete({ where: { id: rivalGroup.id } });
      await prisma.user.delete({ where: { id: rivalUser.id } });
      await prisma.college.delete({ where: { id: rival.id } });
    });

    const detail = await http
      .get(`/api/v1/community/groups/${rivalGroup.id}`)
      .set(auth(adminToken));
    expect(detail.status).toBe(404);
    const join = await http
      .post(`/api/v1/community/groups/${rivalGroup.id}/membership`)
      .set(auth(studentToken));
    expect(join.status).toBe(404);
  });

  it('unauthenticated requests are rejected on M7 surfaces', async () => {
    for (const path of [
      '/api/v1/community/posts',
      '/api/v1/community/groups',
      '/api/v1/community/societies',
      '/api/v1/community/events',
      '/api/v1/community/resources',
    ]) {
      const res = await http.get(path);
      expect(res.status).toBe(401);
    }
  });
});
