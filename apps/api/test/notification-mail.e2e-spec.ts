import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { EventsService } from '../src/events/events.module';
import { MAIL_TRANSPORT, type OutgoingMail } from '../src/mail/mail.module';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

class CapturingMailTransport {
  sent: OutgoingMail[] = [];
  async deliver(mail: OutgoingMail): Promise<void> {
    this.sent.push(mail);
  }
  reset(): void {
    this.sent = [];
  }
}

const settle = () => new Promise((r) => setTimeout(r, 200));

/**
 * M12-W2 — notification email channel + per-user opt-out.
 * Events are emitted through the real EventsService so the real listeners
 * (in-app rows + mail) run; the DI fake captures deliveries.
 */
describe('M12-W2 — notification email channel', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let events: EventsService;
  const fake = new CapturingMailTransport();
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let rivalCollegeId: string;
  const madeUserIds: string[] = [];

  async function makeUser(tag: string, college: string, emailOptOut = false) {
    const argon2 = await import('argon2');
    const user = await prisma.user.create({
      data: {
        college: { connect: { id: college } },
        email: `w2mail-${tag}-${suffix}@campusos.dev`,
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        role: 'STUDENT',
        verificationStatus: 'LEGACY',
        emailOptOut,
        firstName: `W2${tag}`,
        lastName: 'Mail',
        mustChangePassword: false,
      },
    });
    madeUserIds.push(user.id);
    return user;
  }

  beforeAll(async () => {
    process.env.SMTP_URL = 'smtp://fake:fake@127.0.0.1:2525';
    process.env.MAIL_FROM = 'CampusOS <no-reply@test.campusos.dev>';
    process.env.APP_BASE_URL = 'https://campus.test.example';
    app = await createTestApp([{ token: MAIL_TRANSPORT, value: fake }]);
    prisma = app.get(PrismaService);
    events = app.get(EventsService);
    http = request(app.getHttpServer());
    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
    const rival = await prisma.college.create({
      data: { name: 'Rival Mail College', code: `RVM-${suffix}` },
    });
    rivalCollegeId = rival.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: madeUserIds } } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ actorId: { in: madeUserIds } }, { targetId: { in: madeUserIds } }],
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: madeUserIds } } });
    await prisma.auditLog.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.college.delete({ where: { id: rivalCollegeId } });
    delete process.env.SMTP_URL;
    delete process.env.MAIL_FROM;
    delete process.env.APP_BASE_URL;
    await app.close();
  });

  beforeEach(() => fake.reset());

  describe('event coverage', () => {
    it('results.published: in-app rows for all, email only to non-opted-out', async () => {
      const a = await makeUser('res-a', collegeId, false);
      const b = await makeUser('res-b', collegeId, true); // opted out
      // F4: the listener anchors collegeId to the real exam aggregate.
      const exam = await prisma.exam.findFirstOrThrow({
        where: { collegeId, status: 'PUBLISHED' },
      });
      events.emit({
        type: 'results.published',
        examId: exam.id,
        examTitle: 'Midterm CS101',
        studentUserIds: [a.id, b.id],
      });
      await settle();

      // In-app rows regardless of opt-out.
      for (const u of [a, b]) {
        expect(
          await prisma.notification.count({
            where: { userId: u.id, type: 'results.published' },
          }),
        ).toBe(1);
      }
      // Email only to the opted-in user.
      expect(fake.sent).toHaveLength(1);
      expect(fake.sent[0].to).toBe(a.email);
      expect(fake.sent[0].subject).toContain('Midterm CS101');
      expect(fake.sent[0].text).toContain('https://campus.test.example/');
    });

    it('invoice.issued and invoice.overdue email the student', async () => {
      const u = await makeUser('inv', collegeId);
      // F4: the listener anchors collegeId to the real invoice aggregate.
      const invoice = await prisma.invoice.findFirstOrThrow({
        where: { collegeId },
      });
      events.emit({
        type: 'invoice.issued',
        studentUserId: u.id,
        invoiceId: invoice.id,
        amount: '1,500',
        dueDate: '2026-09-30',
      });
      events.emit({
        type: 'invoice.overdue',
        studentUserId: u.id,
        invoiceId: invoice.id,
        amount: '1,500',
        dueDate: '2026-09-30',
      });
      await settle();
      expect(fake.sent).toHaveLength(2);
      expect(fake.sent.map((m) => m.subject).sort()).toEqual([
        'Fee invoice overdue',
        'New fee invoice',
      ]);
      expect(
        await prisma.notification.count({ where: { userId: u.id } }),
      ).toBe(2);
    });

    it('announcement.published mails the resolved audience, excluding author and opted-out; tenant-scoped', async () => {
      const optedIn = await makeUser('ann-in', collegeId, false);
      const optedOut = await makeUser('ann-out', collegeId, true);
      const rivalUser = await makeUser('ann-rival', rivalCollegeId, false);

      app.get(LoginRateLimiterService).reset();
      const login = await http
        .post('/api/v1/auth/login')
        .send({ email: 'admin@campusos.dev', password: DEMO_PASSWORD });
      const res = await http
        .post('/api/v1/announcements')
        .set({ Authorization: `Bearer ${login.body.data.accessToken}` })
        .send({
          title: `W2 Mail Test ${suffix}`,
          body: 'Hello campus',
          audienceScope: 'ROLE',
          audienceIds: ['STUDENT'],
        });
      expect(res.status).toBe(201);
      await settle();

      const recipients = fake.sent.map((m) => m.to);
      expect(recipients).toContain(optedIn.email);
      expect(recipients).not.toContain(optedOut.email);
      // Adversarial tenancy: the rival-college student is NEVER mailed.
      expect(recipients).not.toContain(rivalUser.email);
      const announcementMails = fake.sent.filter((m) =>
        m.subject.includes(`W2 Mail Test ${suffix}`),
      );
      expect(announcementMails.length).toBeGreaterThan(0);
      // Opted-out user still got the in-app row.
      expect(
        await prisma.notification.count({
          where: { userId: optedOut.id, type: 'announcement.published' },
        }),
      ).toBe(1);
    });

    it('excluded events (community like) never generate email', async () => {
      const owner = await makeUser('like', collegeId);
      events.emit({
        type: 'community.like',
        actorUserId: owner.id,
        actorName: 'Some One',
        targetOwnerUserId: owner.id,
        postId: 'p1',
      });
      await settle();
      expect(fake.sent).toHaveLength(0);
    });
  });

  describe('opt-out semantics', () => {
    it('opt-out does NOT suppress W1 transactional mail (reset link)', async () => {
      const u = await makeUser('trans', collegeId, true); // opted out
      app.get(LoginRateLimiterService).reset();
      const login = await http
        .post('/api/v1/auth/login')
        .send({ email: 'admin@campusos.dev', password: DEMO_PASSWORD });
      const res = await http
        .post(`/api/v1/users/${u.id}/reset-link`)
        .set({ Authorization: `Bearer ${login.body.data.accessToken}` });
      expect(res.status).toBe(201);
      expect(fake.sent).toHaveLength(1); // security mail delivered anyway
      expect(fake.sent[0].subject).toContain('Reset your CampusOS password');
    });

    it('PATCH /me/preferences updates only the caller and is audited without PII', async () => {
      const u = await makeUser('prefs', collegeId, false);
      const other = await makeUser('prefs-other', collegeId, false);
      app.get(LoginRateLimiterService).reset();
      const login = await http
        .post('/api/v1/auth/login')
        .send({ email: u.email, password: DEMO_PASSWORD });
      const token = login.body.data.accessToken as string;

      const anon = await http
        .patch('/api/v1/me/preferences')
        .send({ emailOptOut: true });
      expect(anon.status).toBe(401);

      const res = await http
        .patch('/api/v1/me/preferences')
        .set({ Authorization: `Bearer ${token}` })
        .send({ emailOptOut: true });
      expect(res.status).toBe(200);
      expect(res.body.data.emailOptOut).toBe(true);

      const me = await http
        .get('/api/v1/me')
        .set({ Authorization: `Bearer ${token}` });
      expect(me.body.data.emailOptOut).toBe(true);

      // Only the caller's row changed.
      const otherAfter = await prisma.user.findUniqueOrThrow({
        where: { id: other.id },
      });
      expect(otherAfter.emailOptOut).toBe(false);

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'preferences.updated', targetId: u.id },
      });
      expect(audit?.metadata).toEqual({ emailOptOut: true });
      expect(JSON.stringify(audit?.metadata)).not.toContain('@');

      // Strict schema: unknown keys rejected.
      const bad = await http
        .patch('/api/v1/me/preferences')
        .set({ Authorization: `Bearer ${token}` })
        .send({ emailOptOut: false, hacked: true });
      expect(bad.status).toBe(400);
    });
  });

  describe('F4 tenant belt (M13 hardening)', () => {
    it('a foreign-college user id passed to the mailer is never mailed', async () => {
      const { NotificationMailerService } = await import(
        '../src/notifications/notification-mailer.service'
      );
      const mailer = app.get(NotificationMailerService);
      const foreign = await makeUser('belt-foreign', rivalCollegeId, false);
      const local = await makeUser('belt-local', collegeId, false);

      // Both ids passed, but the event's college is the demo college:
      // the belt filters the rival user out at the query level.
      await mailer.sendToUsers(collegeId, [foreign.id, local.id], () => ({
        kind: 'announcement',
        firstName: 'X',
        title: 'Belt check',
        url: 'https://campus.test.example/announcements',
      }));
      const recipients = fake.sent.map((m) => m.to);
      expect(recipients).toContain(local.email);
      expect(recipients).not.toContain(foreign.email);
    });
  });

  describe('resilience', () => {
    it('mail transport failure leaves in-app notifications intact', async () => {
      const u = await makeUser('resil', collegeId);
      const failing = {
        deliver: async () => {
          throw new Error('smtp down');
        },
      };
      // Swap behavior on the shared fake by monkey-patching deliver.
      const original = fake.deliver.bind(fake);
      (fake as { deliver: (m: OutgoingMail) => Promise<void> }).deliver =
        failing.deliver;
      try {
        const invoice = await prisma.invoice.findFirstOrThrow({
          where: { collegeId },
        });
        events.emit({
          type: 'invoice.issued',
          studentUserId: u.id,
          invoiceId: invoice.id,
          amount: '900',
          dueDate: '2026-10-01',
        });
        await settle();
        expect(
          await prisma.notification.count({
            where: { userId: u.id, type: 'invoice.issued' },
          }),
        ).toBe(1);
        const failedAudit = await prisma.auditLog.findFirst({
          where: { action: 'mail.failed', targetId: u.id },
        });
        expect(failedAudit?.metadata).toEqual({ template: 'invoice_issued' });
      } finally {
        (fake as { deliver: (m: OutgoingMail) => Promise<void> }).deliver =
          original;
      }
    });
  });
});

describe('M12-W2 — unconfigured SMTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: EventsService;
  const fake = new CapturingMailTransport();
  const suffix = `${Date.now().toString(36)}u`;
  let userId: string;

  beforeAll(async () => {
    delete process.env.SMTP_URL;
    delete process.env.MAIL_FROM;
    app = await createTestApp([{ token: MAIL_TRANSPORT, value: fake }]);
    prisma = app.get(PrismaService);
    events = app.get(EventsService);
    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    const argon2 = await import('argon2');
    const user = await prisma.user.create({
      data: {
        college: { connect: { id: admin.collegeId } },
        email: `w2off-${suffix}@campusos.dev`,
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        role: 'STUDENT',
        firstName: 'Off',
        lastName: 'Mail',
        mustChangePassword: false,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: userId }, { targetId: userId }] },
    });
    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it('in-app notifications flow normally with zero mail activity', async () => {
    events.emit({
      type: 'results.published',
      examId: 'x',
      examTitle: 'Offline Exam',
      studentUserIds: [userId],
    });
    await settle();
    expect(
      await prisma.notification.count({
        where: { userId, type: 'results.published' },
      }),
    ).toBe(1);
    expect(fake.sent).toHaveLength(0);
    expect(
      await prisma.auditLog.count({
        where: { action: { startsWith: 'mail.' }, targetId: userId },
      }),
    ).toBe(0);
  });
});
