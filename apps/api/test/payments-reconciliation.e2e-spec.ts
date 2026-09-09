import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import {
  PAYMENT_GATEWAY,
  type GatewayVerification,
  type PaymentGatewayAdapter,
} from '../src/payments/gateway.adapter';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M14-W5 — admin reconciliation surface.
 * fees.manage/ALL is the capability; every query is tenant-scoped; the
 * verify action only ROUTES a provider answer into the W1 core.
 */
describe('M14-W5 — admin reconciliation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let rivalCollegeId: string;
  let studentProfileId: string;
  let studentUserId: string;
  let structureId: string;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  let guardianToken: string;
  let guardianUserId: string;
  let rivalAttemptId: string;
  const madeInvoiceIds: string[] = [];

  let verifyResult: GatewayVerification = {
    state: 'PENDING',
    amount: '0.00',
    currency: 'PKR',
  };
  let refSeq = 0;
  const fakeGateway: PaymentGatewayAdapter = {
    provider: 'SAFEPAY',
    async createCheckoutSession() {
      refSeq += 1;
      return {
        providerRef: `track_w5_${suffix}_${refSeq}`,
        checkoutUrl: 'https://sandbox.api.getsafepay.com/embedded/?x=1',
      };
    },
    async verifyPayment() {
      return verifyResult;
    },
    verifyWebhookSignature: () => false,
    parseWebhookEvent: () => null,
    // M16-W2 interface additions — unused by this spec.
    async createRefund() {
      throw new Error('refunds not used in this spec');
    },
    async verifyRefund() {
      return { state: 'PAID' as const, refunds: [] };
    },
  };

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  let invoiceSeq = 0;
  async function makeInvoice(amount: string) {
    invoiceSeq += 1;
    const invoice = await prisma.invoice.create({
      data: {
        collegeId,
        studentId: studentProfileId,
        structureId,
        invoiceNo: `W5-${suffix}-${invoiceSeq}`,
        amount,
        dueDate: new Date('2027-01-31'),
        status: 'PENDING',
      },
    });
    madeInvoiceIds.push(invoice.id);
    return invoice;
  }

  async function initiated(amount: string) {
    const invoice = await makeInvoice(amount);
    const res = await http
      .post(`/api/v1/fees/invoices/${invoice.id}/pay`)
      .set(auth(studentToken));
    expect(res.status).toBe(201);
    return { invoice, attemptId: res.body.data.attemptId as string };
  }

  beforeAll(async () => {
    app = await createTestApp([{ token: PAYMENT_GATEWAY, value: fakeGateway }]);
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const student = await prisma.user.findFirstOrThrow({
      where: { email: 'student@campusos.dev' },
      include: { studentProfile: true },
    });
    studentUserId = student.id;
    studentProfileId = student.studentProfile!.id;
    collegeId = student.collegeId;
    structureId = (
      await prisma.feeStructure.findFirstOrThrow({ where: { collegeId } })
    ).id;

    const argon2 = await import('argon2');
    const guardian = await prisma.user.create({
      data: {
        college: { connect: { id: collegeId } },
        email: `w5rec-g-${suffix}@campusos.dev`,
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        role: 'GUARDIAN',
        firstName: 'W5',
        lastName: 'G',
        mustChangePassword: false,
      },
    });
    guardianUserId = guardian.id;
    await prisma.guardianLink.create({
      data: {
        collegeId,
        guardianUserId: guardian.id,
        studentProfileId,
        relationship: 'Parent',
      },
    });

    // Rival college with one attempt.
    const rival = await prisma.college.create({
      data: { name: 'Rival W5R College', code: `RVW5R-${suffix}` },
    });
    rivalCollegeId = rival.id;
    const rivalDept = await prisma.department.create({
      data: { college: { connect: { id: rival.id } }, code: `RVW5RD-${suffix}`, name: 'D' },
    });
    const rivalYear = await prisma.academicYear.create({
      data: {
        college: { connect: { id: rival.id } },
        label: `AY-${suffix}`,
        startsOn: new Date('2026-08-01'),
        endsOn: new Date('2027-06-30'),
      },
    });
    const rivalTerm = await prisma.term.create({
      data: {
        college: { connect: { id: rival.id } },
        academicYear: { connect: { id: rivalYear.id } },
        label: `T-${suffix}`,
        startsOn: new Date('2026-08-01'),
        endsOn: new Date('2026-12-20'),
      },
    });
    const rivalStructure = await prisma.feeStructure.create({
      data: {
        college: { connect: { id: rival.id } },
        term: { connect: { id: rivalTerm.id } },
        name: 'Rival Tuition',
        totalAmount: '900',
      },
    });
    const rivalUser = await prisma.user.create({
      data: {
        college: { connect: { id: rival.id } },
        email: `w5rec-rs-${suffix}@campusos.dev`,
        role: 'STUDENT',
        firstName: 'R',
        lastName: 'S',
        mustChangePassword: false,
      },
    });
    const rivalProfile = await prisma.studentProfile.create({
      data: {
        user: { connect: { id: rivalUser.id } },
        college: { connect: { id: rival.id } },
        department: { connect: { id: rivalDept.id } },
        admissionNo: `RVW5R-${suffix}`,
        rollNo: `RVW5RR-${suffix}`,
        batch: '2026',
      },
    });
    const rivalInvoice = await prisma.invoice.create({
      data: {
        collegeId: rival.id,
        studentId: rivalProfile.id,
        structureId: rivalStructure.id,
        invoiceNo: `RVW5R-INV-${suffix}`,
        amount: '900',
        dueDate: new Date('2027-01-31'),
        status: 'PENDING',
      },
    });
    const rivalAttempt = await prisma.paymentAttempt.create({
      data: {
        collegeId: rival.id,
        invoiceId: rivalInvoice.id,
        initiatedById: rivalUser.id,
        amount: '900',
        provider: 'SAFEPAY',
        providerRef: `track_rival_${suffix}`,
        status: 'PENDING',
      },
    });
    rivalAttemptId = rivalAttempt.id;

    adminToken = await login('admin@campusos.dev');
    teacherToken = await login('teacher@campusos.dev');
    studentToken = await login('student@campusos.dev');
    guardianToken = await login(guardian.email);
  });

  afterAll(async () => {
    await prisma.gatewayEvent.deleteMany({});
    await prisma.paymentAttempt.deleteMany({
      where: { OR: [{ invoiceId: { in: madeInvoiceIds } }, { collegeId: rivalCollegeId }] },
    });
    // M20-W1: issued documents Restrict money-row deletion — clear them first.
    await prisma.financeDocument.deleteMany({ where: { invoiceId: { in: madeInvoiceIds } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: madeInvoiceIds } } });
    await prisma.invoice.deleteMany({
      where: { OR: [{ id: { in: madeInvoiceIds } }, { collegeId: rivalCollegeId }] },
    });
    await prisma.guardianLink.deleteMany({ where: { guardianUserId } });
    await prisma.notification.deleteMany({
      where: { type: { in: ['payment.succeeded', 'payment.failed'] } },
    });
    await prisma.studentProfile.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.feeStructure.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.term.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.academicYear.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.department.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: guardianUserId }, { collegeId: rivalCollegeId }] },
    });
    await prisma.user.deleteMany({
      where: { OR: [{ id: guardianUserId }, { collegeId: rivalCollegeId }] },
    });
    await prisma.college.delete({ where: { id: rivalCollegeId } });
    await app.close();
  });

  describe('authorization', () => {
    it('admin lists; teacher/student/guardian 403; anonymous 401', async () => {
      const ok = await http
        .get('/api/v1/payments/reconciliation')
        .set(auth(adminToken));
      expect(ok.status).toBe(200);
      expect(Array.isArray(ok.body.data)).toBe(true);
      for (const token of [teacherToken, studentToken, guardianToken]) {
        expect(
          (await http.get('/api/v1/payments/reconciliation').set(auth(token))).status,
        ).toBe(403);
        expect(
          (
            await http
              .post(`/api/v1/payments/reconciliation/${rivalAttemptId}/verify`)
              .set(auth(token))
          ).status,
        ).toBe(403);
      }
      expect((await http.get('/api/v1/payments/reconciliation')).status).toBe(401);
    });
  });

  describe('tenancy', () => {
    it('rival-college attempts are invisible, unverifiable and non-leaking', async () => {
      const list = await http
        .get('/api/v1/payments/reconciliation')
        .set(auth(adminToken));
      expect(
        list.body.data.some(
          (row: { id: string }) => row.id === rivalAttemptId,
        ),
      ).toBe(false);
      expect(
        (
          await http
            .post(`/api/v1/payments/reconciliation/${rivalAttemptId}/verify`)
            .set(auth(adminToken))
        ).status,
      ).toBe(404); // indistinguishable from nonexistent
      expect(
        (
          await http
            .post('/api/v1/payments/reconciliation/garbage-id/verify')
            .set(auth(adminToken))
        ).status,
      ).toBe(404);
    });
  });

  describe('gateway verification', () => {
    it('PENDING + provider PAID → settled through the core (payment, invoice, notification, audit)', async () => {
      const { invoice, attemptId } = await initiated('1500');
      verifyResult = { state: 'PAID', amount: '1500.00', currency: 'PKR' };
      const res = await http
        .post(`/api/v1/payments/reconciliation/${attemptId}/verify`)
        .set(auth(adminToken));
      verifyResult = { state: 'PENDING', amount: '0.00', currency: 'PKR' };
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('SUCCEEDED');
      expect(res.body.data.outcome).toBe('SETTLED');

      const payments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
      expect(payments).toHaveLength(1);
      expect(payments[0].method).toBe('ONLINE');
      expect(
        (await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
      ).toBe('PAID');
      expect(
        await prisma.notification.count({
          where: { userId: studentUserId, type: 'payment.succeeded' },
        }),
      ).toBeGreaterThanOrEqual(1);

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'payments.reconciliation_verified', targetId: attemptId },
      });
      expect(audit.metadata).toEqual({ provider: 'SAFEPAY', outcome: 'SETTLED' });

      // Repeat verify: NO_ACTION, still exactly one Payment.
      const again = await http
        .post(`/api/v1/payments/reconciliation/${attemptId}/verify`)
        .set(auth(adminToken));
      expect(again.body.data.outcome).toBe('NO_ACTION');
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
    });

    it('provider PENDING keeps the attempt pending; provider FAILED fails it', async () => {
      const pending = await initiated('400');
      verifyResult = { state: 'PENDING', amount: '0.00', currency: 'PKR' };
      const stillPending = await http
        .post(`/api/v1/payments/reconciliation/${pending.attemptId}/verify`)
        .set(auth(adminToken));
      expect(stillPending.body.data.status).toBe('PENDING');
      expect(stillPending.body.data.outcome).toBe('STILL_PENDING');

      verifyResult = { state: 'FAILED', amount: '0.00', currency: 'PKR' };
      const failed = await http
        .post(`/api/v1/payments/reconciliation/${pending.attemptId}/verify`)
        .set(auth(adminToken));
      verifyResult = { state: 'PENDING', amount: '0.00', currency: 'PKR' };
      expect(failed.body.data.status).toBe('FAILED');
      expect(
        await prisma.payment.count({ where: { invoiceId: pending.invoice.id } }),
      ).toBe(0);

      // Terminal: repeat verify never resurrects.
      const dead = await http
        .post(`/api/v1/payments/reconciliation/${pending.attemptId}/verify`)
        .set(auth(adminToken));
      expect(dead.body.data.status).toBe('FAILED');
      expect(dead.body.data.outcome).toBe('NO_ACTION');
    });

    it('provider amount mismatch → safe persisted failure, no settlement', async () => {
      const { invoice, attemptId } = await initiated('777');
      verifyResult = { state: 'PAID', amount: '10.00', currency: 'PKR' };
      const res = await http
        .post(`/api/v1/payments/reconciliation/${attemptId}/verify`)
        .set(auth(adminToken));
      verifyResult = { state: 'PENDING', amount: '0.00', currency: 'PKR' };
      expect(res.body.data.status).toBe('FAILED');
      expect(res.body.data.outcome).toBe('REJECTED');
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
    });
  });

  describe('overpaid visibility', () => {
    it('overpaid attempts are flagged; invoice stays capped at PAID; no negative payments', async () => {
      const { invoice, attemptId } = await initiated('1000');
      // Manual payment lands while the gateway attempt is open.
      await http
        .post(`/api/v1/fees/invoices/${invoice.id}/payments`)
        .set(auth(adminToken))
        .send({ amount: 600, method: 'CASH' });
      verifyResult = { state: 'PAID', amount: '1000.00', currency: 'PKR' };
      await http
        .post(`/api/v1/payments/reconciliation/${attemptId}/verify`)
        .set(auth(adminToken));
      verifyResult = { state: 'PENDING', amount: '0.00', currency: 'PKR' };

      const list = await http
        .get('/api/v1/payments/reconciliation?status=SUCCEEDED')
        .set(auth(adminToken));
      const row = list.body.data.find((r: { id: string }) => r.id === attemptId);
      expect(row.overpaid).toBe(true);
      expect(
        (await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
      ).toBe('PAID');
      const payments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
      expect(payments.every((p) => Number(p.amount) > 0)).toBe(true); // no negative rows
      expect(payments).toHaveLength(2); // manual 600 + online 1000, both preserved
    });
  });

  describe('unmatched events & data minimization', () => {
    it('UNMATCHED_* ledger rows are listed without payloads; response carries no secrets', async () => {
      await prisma.gatewayEvent.create({
        data: {
          provider: 'SAFEPAY',
          eventId: `evt_w5_unm_${suffix}`,
          outcome: 'UNMATCHED_SUCCEEDED',
        },
      });
      const res = await http
        .get('/api/v1/payments/reconciliation/unmatched')
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      const row = res.body.data.find(
        (event: { eventId: string }) => event.eventId === `evt_w5_unm_${suffix}`,
      );
      expect(row).toMatchObject({
        provider: 'SAFEPAY',
        outcome: 'UNMATCHED_SUCCEEDED',
      });
      expect(Object.keys(row).sort()).toEqual(
        ['eventId', 'id', 'outcome', 'provider', 'receivedAt'].sort(),
      );
      const raw = JSON.stringify(res.body);
      expect(raw).not.toMatch(/signature|secret|body|payload/i);

      // Filters are validated — junk status is rejected, not passed to Prisma.
      expect(
        (
          await http
            .get('/api/v1/payments/reconciliation?status=DROP TABLE')
            .set(auth(adminToken))
        ).status,
      ).toBe(400);
    });
  });

  describe('export', () => {
    it('fees.csv reflects ONLINE settlements in paid totals (tenant-scoped, admin-only)', async () => {
      const { invoice, attemptId } = await initiated('250');
      verifyResult = { state: 'PAID', amount: '250.00', currency: 'PKR' };
      await http
        .post(`/api/v1/payments/reconciliation/${attemptId}/verify`)
        .set(auth(adminToken));
      verifyResult = { state: 'PENDING', amount: '0.00', currency: 'PKR' };

      const csv = await http
        .get('/api/v1/exports/fees.csv')
        .set(auth(adminToken));
      expect(csv.status).toBe(200);
      const line = csv.text
        .split('\n')
        .find((l: string) => l.includes(invoice.invoiceNo));
      expect(line).toBeDefined();
      expect(line).toContain('250'); // paid total includes the ONLINE payment
      expect(line).toContain('PAID');
      // Rival-college invoice never leaks into this export.
      expect(csv.text).not.toContain(`RVW5R-INV-${suffix}`);
      // Students remain refused.
      expect(
        (await http.get('/api/v1/exports/fees.csv').set(auth(studentToken))).status,
      ).toBe(403);
    });
  });
});
