import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { RateLimiterService } from '../src/common/rate-limiter.service';
import { MAIL_TRANSPORT, type OutgoingMail } from '../src/mail/mail.module';
import { validateEnv } from '../src/config/env';
import { ROUTE_PERMISSIONS } from '@campusos/shared';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';
const PNG = Buffer.concat([
  Buffer.from('\x89PNG\r\n\x1a\n', 'binary'),
  Buffer.alloc(16, 5),
]);

/** Capturing fake transport — no real SMTP ever runs in tests. */
class CapturingMailTransport {
  sent: OutgoingMail[] = [];
  failNext = false;
  async deliver(mail: OutgoingMail): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('boom');
    }
    this.sent.push(mail);
  }
  reset(): void {
    this.sent = [];
    this.failNext = false;
  }
  last(): OutgoingMail {
    return this.sent[this.sent.length - 1];
  }
}

/**
 * M12-W1 — email foundation.
 * Uses the DI fake at MAIL_TRANSPORT; asserts content, absolute links,
 * failure isolation, audit hygiene and the feature-off path.
 */
describe('M12-W1 — email foundation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const fake = new CapturingMailTransport();
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let departmentId: string;
  let adminToken: string;
  const madeUserIds: string[] = [];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function createStudent(tag: string, extra: Record<string, string> = {}) {
    const res = await http
      .post('/api/v1/students')
      .set(auth(adminToken))
      .send({
        firstName: 'Mail',
        lastName: tag,
        email: `mail-${tag}-${suffix}@campusos.dev`,
        departmentId,
        admissionNo: `ML-${tag}-${suffix}`,
        rollNo: `MLR-${tag}-${suffix}`,
        batch: '2026',
        ...extra,
      });
    expect(res.status).toBe(201);
    const user = await prisma.user.findFirstOrThrow({
      where: { email: `mail-${tag}-${suffix}@campusos.dev` },
    });
    madeUserIds.push(user.id);
    return { res, user };
  }

  beforeAll(async () => {
    process.env.SMTP_URL = 'smtp://fake:fake@127.0.0.1:2525';
    process.env.MAIL_FROM = 'CampusOS <no-reply@test.campusos.dev>';
    process.env.APP_BASE_URL = 'https://campus.test.example';
    app = await createTestApp([{ token: MAIL_TRANSPORT, value: fake }]);
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());
    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
    const department = await prisma.department.create({
      data: {
        college: { connect: { id: collegeId } },
        code: `ML-${suffix.toUpperCase()}`,
        name: 'Mail Dept',
      },
    });
    departmentId = department.id;
    adminToken = await login('admin@campusos.dev');
  });

  afterAll(async () => {
    await prisma.studentIdentityClaim.deleteMany({
      where: { userId: { in: madeUserIds } },
    });
    await prisma.evidenceFile.deleteMany({
      where: { uploaderId: { in: madeUserIds } },
    });
    await prisma.notification.deleteMany({ where: { userId: { in: madeUserIds } } });
    await prisma.studentProfile.deleteMany({
      where: { userId: { in: madeUserIds } },
    });
    await prisma.teacherProfile.deleteMany({
      where: { userId: { in: madeUserIds } },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ actorId: { in: madeUserIds } }, { targetId: { in: madeUserIds } }],
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: madeUserIds } } });
    await prisma.department.delete({ where: { id: departmentId } });
    delete process.env.SMTP_URL;
    delete process.env.MAIL_FROM;
    delete process.env.APP_BASE_URL;
    await app.close();
  });

  beforeEach(() => fake.reset());

  describe('config contract', () => {
    it('partial SMTP configuration fails env validation', () => {
      expect(() =>
        validateEnv({
          NODE_ENV: 'development',
          DATABASE_URL: 'postgresql://x:y@localhost:5432/z',
          JWT_ACCESS_SECRET: 'dev-secret',
          SMTP_URL: 'smtp://h:1',
        }),
      ).toThrow(/mail is partially configured; missing: MAIL_FROM/);
    });

    it('the dead /profile route mapping is gone (decision O4)', () => {
      expect(ROUTE_PERMISSIONS['/profile']).toBeUndefined();
    });
  });

  describe('invitation mail', () => {
    it('student creation emails the exact invite link, absolute', async () => {
      const { res } = await createStudent('inv');
      expect(fake.sent).toHaveLength(1);
      const mail = fake.last();
      expect(mail.to).toBe(`mail-inv-${suffix}@campusos.dev`);
      expect(mail.subject).toContain('student account');
      expect(mail.text).toContain(
        `https://campus.test.example${res.body.data.invite.url}`,
      );
      // The mailed link and the copy-URL dialog link are the same token.
      expect(res.body.data.invite.url).toMatch(/^\/accept-invite\?token=/);
    });

    it('teacher creation emails a staff invite', async () => {
      const res = await http
        .post('/api/v1/teachers')
        .set(auth(adminToken))
        .send({
          firstName: 'Mail',
          lastName: 'Teacher',
          email: `mail-teacher-${suffix}@campusos.dev`,
          departmentId,
          employeeNo: `MLE-${suffix}`,
          designation: 'Lecturer',
          joinedOn: '2026-01-05',
        });
      expect(res.status).toBe(201);
      const user = await prisma.user.findFirstOrThrow({
        where: { email: `mail-teacher-${suffix}@campusos.dev` },
      });
      madeUserIds.push(user.id);
      expect(fake.sent).toHaveLength(1);
      expect(fake.last().subject).toContain('staff account');
      expect(fake.last().text).toContain(res.body.data.invite.url);
    });

    it('CSV import sends one invite mail per created row', async () => {
      const csv = [
        'firstName,lastName,email,admissionNo,rollNo,batch,departmentCode',
        `Ana,Csv,mail-csv1-${suffix}@campusos.dev,ML-CSV1-${suffix},MC1-${suffix},2026,ML-${suffix.toUpperCase()}`,
        `Ben,Csv,mail-csv2-${suffix}@campusos.dev,ML-CSV2-${suffix},MC2-${suffix},2026,ML-${suffix.toUpperCase()}`,
      ].join('\n');
      const res = await http
        .post('/api/v1/students/import')
        .set(auth(adminToken))
        .attach('file', Buffer.from(csv, 'utf8'), 'students.csv');
      expect(res.status).toBe(201);
      expect(res.body.data.created).toBe(2);
      for (const email of [
        `mail-csv1-${suffix}@campusos.dev`,
        `mail-csv2-${suffix}@campusos.dev`,
      ]) {
        const user = await prisma.user.findFirstOrThrow({ where: { email } });
        madeUserIds.push(user.id);
      }
      expect(fake.sent).toHaveLength(2);
      expect(new Set(fake.sent.map((m) => m.to)).size).toBe(2);
      for (const [i, entry] of (
        res.body.data.createdStudents as Array<{ inviteUrl: string }>
      ).entries()) {
        expect(
          fake.sent.some((m) => m.text.includes(entry.inviteUrl)),
        ).toBe(true);
        expect(i).toBeLessThan(2);
      }
    });

    it('CRLF in names cannot inject headers', async () => {
      const { user } = await createStudent('crlf', {
        firstName: 'Evil\r\nBcc: victim@x.dev',
      });
      expect(user.id).toBeTruthy();
      const mail = fake.last();
      // Injection requires newlines; the sanitizer flattens them to spaces.
      expect(mail.subject).not.toMatch(/[\r\n]/);
      expect(mail.text).not.toContain('Evil\r\n');
      expect(mail.text).toContain('Evil Bcc: victim@x.dev'); // one flat line
    });
  });

  describe('reset mail', () => {
    it('admin reset-link issuance emails the reset URL', async () => {
      const { user } = await createStudent('reset');
      fake.reset();
      const res = await http
        .post(`/api/v1/users/${user.id}/reset-link`)
        .set(auth(adminToken));
      expect(res.status).toBe(201);
      expect(fake.sent).toHaveLength(1);
      expect(fake.last().subject).toContain('Reset your CampusOS password');
      expect(fake.last().text).toContain(res.body.data.url);
    });
  });

  describe('verification decision mail', () => {
    it('rejection sends exactly one email with the reason; retry sends none', async () => {
      const argon2 = await import('argon2');
      const claimant = await prisma.user.create({
        data: {
          college: { connect: { id: collegeId } },
          email: `mail-claimant-${suffix}@campusos.dev`,
          passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
          role: 'STUDENT',
          verificationStatus: 'UNVERIFIED',
          firstName: 'Claim',
          lastName: 'Ant',
          mustChangePassword: false,
        },
      });
      madeUserIds.push(claimant.id);
      app.get(RateLimiterService).reset();
      const token = await login(claimant.email);
      const up = await http
        .post('/api/v1/verification/evidence')
        .set(auth(token))
        .attach('file', PNG, 'card.png');
      const claim = await http
        .post('/api/v1/verification/claims')
        .set(auth(token))
        .send({
          claimedAdmissionNo: `GHOST-${suffix}`,
          evidenceFileKey: up.body.data.evidenceFileKey,
        });
      fake.reset();

      const decide = await http
        .post(`/api/v1/verification/claims/${claim.body.data.id}/decision`)
        .set(auth(adminToken))
        .send({ decision: 'REJECT', rejectionReason: 'No matching record found' });
      expect(decide.status).toBe(201);
      await new Promise((r) => setTimeout(r, 150));
      expect(fake.sent).toHaveLength(1);
      expect(fake.last().to).toBe(claimant.email);
      expect(fake.last().text).toContain('No matching record found');
      expect(fake.last().text).toContain('https://campus.test.example/verify');

      // Retried decision conflicts upstream → no second mail.
      const retry = await http
        .post(`/api/v1/verification/claims/${claim.body.data.id}/decision`)
        .set(auth(adminToken))
        .send({ decision: 'REJECT', rejectionReason: 'again' });
      expect(retry.status).toBe(409);
      await new Promise((r) => setTimeout(r, 150));
      expect(fake.sent).toHaveLength(1);
    });

    it('invite acceptance auto-verification sends the approved email', async () => {
      const { res, user } = await createStudent('approve');
      fake.reset();
      const token = (res.body.data.invite.url as string).split('token=')[1];
      const accept = await http
        .post('/api/v1/auth/accept-invite')
        .send({ token, password: 'MailW1pass123' });
      expect(accept.status).toBe(200);
      await new Promise((r) => setTimeout(r, 150));
      const approved = fake.sent.filter((m) =>
        m.subject.includes('verified'),
      );
      expect(approved).toHaveLength(1);
      expect(approved[0].to).toBe(user.email);
    });
  });

  describe('failure isolation & audit hygiene', () => {
    it('a failing transport never fails the business operation', async () => {
      fake.failNext = true;
      const { res, user } = await createStudent('failiso');
      expect(res.status).toBe(201); // creation succeeded regardless
      expect(res.body.data.invite.url).toBeTruthy(); // copy-URL path intact

      const failed = await prisma.auditLog.findFirst({
        where: { action: 'mail.failed', targetId: user.id },
      });
      expect(failed).not.toBeNull();
      expect(failed!.metadata).toEqual({ template: 'student_invite' });
    });

    it('audit metadata never contains tokens, URLs or addresses', async () => {
      const rows = await prisma.auditLog.findMany({
        where: { action: { in: ['mail.sent', 'mail.failed'] } },
      });
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const meta = JSON.stringify(row.metadata);
        expect(meta).not.toContain('token=');
        expect(meta).not.toContain('http');
        expect(meta).not.toContain('@');
        expect(Object.keys(row.metadata as object)).toEqual(['template']);
      }
    });
  });
});

describe('M12-W1 — mail feature disabled (no env)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const fake = new CapturingMailTransport();
  const suffix = `${Date.now().toString(36)}off`;
  let userId: string | null = null;
  let departmentId: string;

  beforeAll(async () => {
    delete process.env.SMTP_URL;
    delete process.env.MAIL_FROM;
    app = await createTestApp([{ token: MAIL_TRANSPORT, value: fake }]);
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());
    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    const department = await prisma.department.create({
      data: {
        college: { connect: { id: admin.collegeId } },
        code: `MLOFF-${suffix.toUpperCase()}`,
        name: 'Mail Off Dept',
      },
    });
    departmentId = department.id;
  });

  afterAll(async () => {
    if (userId) {
      await prisma.studentIdentityClaim.deleteMany({ where: { userId } });
      await prisma.studentProfile.deleteMany({ where: { userId } });
      await prisma.auditLog.deleteMany({
        where: { OR: [{ actorId: userId }, { targetId: userId }] },
      });
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.department.delete({ where: { id: departmentId } });
    await app.close();
  });

  it('unconfigured mail: no sends, no mail audit rows, flows unchanged', async () => {
    app.get(LoginRateLimiterService).reset();
    const login = await http
      .post('/api/v1/auth/login')
      .send({ email: 'admin@campusos.dev', password: DEMO_PASSWORD });
    const res = await http
      .post('/api/v1/students')
      .set({ Authorization: `Bearer ${login.body.data.accessToken}` })
      .send({
        firstName: 'Off',
        lastName: 'Mail',
        email: `mailoff-${suffix}@campusos.dev`,
        departmentId,
        admissionNo: `MLOFF-${suffix}`,
        rollNo: `MLOFFR-${suffix}`,
        batch: '2026',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.invite.url).toBeTruthy();
    const user = await prisma.user.findFirstOrThrow({
      where: { email: `mailoff-${suffix}@campusos.dev` },
    });
    userId = user.id;
    expect(fake.sent).toHaveLength(0);
    expect(
      await prisma.auditLog.count({
        where: { action: { startsWith: 'mail.' }, targetId: user.id },
      }),
    ).toBe(0);
  });
});
