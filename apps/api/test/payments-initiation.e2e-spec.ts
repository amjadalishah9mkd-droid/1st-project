import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { PAYMENT_GATEWAY } from '../src/payments/gateway.adapter';
import type {
  CheckoutSessionInput,
  PaymentGatewayAdapter,
} from '../src/payments/gateway.adapter';
import {
  SafepayAdapter,
  toLowestDenomination,
  fromLowestDenomination,
} from '../src/payments/safepay.adapter';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M14-W2 — gateway adapter boundary + POST /fees/invoices/:id/pay.
 * The adapter is a DI-injected capturing fake (MAIL_TRANSPORT pattern) —
 * no network calls; every assertion is about what CampusOS hands the
 * adapter (server-authoritative values) and what it exposes to clients.
 */
describe('M14-W2 — payment initiation endpoint', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let studentProfileId: string;
  let structureId: string;
  let studentToken: string;
  let otherStudentToken: string;
  let guardianToken: string;
  let teacherToken: string;
  let adminToken: string;
  let guardianUserId: string;
  const madeInvoiceIds: string[] = [];

  /** Capturing fake gateway. */
  const calls: CheckoutSessionInput[] = [];
  let nextRef = 0;
  let failNext = false;
  let fixedRef: string | null = null;
  const fakeGateway: PaymentGatewayAdapter = {
    provider: 'SAFEPAY',
    async createCheckoutSession(input) {
      calls.push(input);
      if (failNext) {
        failNext = false;
        const { BadGatewayException } = await import('@nestjs/common');
        throw new BadGatewayException({
          code: 'GATEWAY_ERROR',
          message: 'The payment provider could not be reached',
        });
      }
      nextRef += 1;
      return {
        providerRef: fixedRef ?? `track_${suffix}_${nextRef}`,
        checkoutUrl: `https://sandbox.api.getsafepay.com/embedded/?tracker=track_${suffix}_${nextRef}`,
      };
    },
    async verifyPayment() {
      return { state: 'PENDING', amount: '0.00', currency: 'PKR' };
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
  async function makeInvoice(amount: string, studentId = studentProfileId) {
    invoiceSeq += 1;
    const invoice = await prisma.invoice.create({
      data: {
        collegeId,
        studentId,
        structureId,
        invoiceNo: `W2-${suffix}-${invoiceSeq}`,
        amount,
        dueDate: new Date('2027-01-31'),
        status: 'PENDING',
      },
    });
    madeInvoiceIds.push(invoice.id);
    return invoice;
  }

  beforeAll(async () => {
    app = await createTestApp([{ token: PAYMENT_GATEWAY, value: fakeGateway }]);
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const student = await prisma.user.findFirstOrThrow({
      where: { email: 'student@campusos.dev' },
      include: { studentProfile: true },
    });
    studentProfileId = student.studentProfile!.id;
    collegeId = student.collegeId;
    structureId = (
      await prisma.feeStructure.findFirstOrThrow({ where: { collegeId } })
    ).id;

    // A second student with a known password for cross-student probes.
    const otherProfile = await prisma.studentProfile.findFirstOrThrow({
      where: { collegeId, id: { not: studentProfileId } },
      include: { user: true },
    });
    const argon2 = await import('argon2');
    await prisma.user.update({
      where: { id: otherProfile.user.id },
      data: {
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        mustChangePassword: false,
      },
    });

    // Guardian linked to the paying student (still must be 403).
    const guardian = await prisma.user.create({
      data: {
        college: { connect: { id: collegeId } },
        email: `w2pay-g-${suffix}@campusos.dev`,
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        role: 'GUARDIAN',
        firstName: 'W2',
        lastName: 'Guardian',
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

    studentToken = await login('student@campusos.dev');
    otherStudentToken = await login(otherProfile.user.email);
    guardianToken = await login(guardian.email);
    teacherToken = await login('teacher@campusos.dev');
    adminToken = await login('admin@campusos.dev');
  });

  afterAll(async () => {
    await prisma.paymentAttempt.deleteMany({
      where: { invoiceId: { in: madeInvoiceIds } },
    });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: madeInvoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: madeInvoiceIds } } });
    await prisma.guardianLink.deleteMany({ where: { guardianUserId } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: guardianUserId }, { targetId: guardianUserId }] },
    });
    await prisma.user.deleteMany({ where: { id: guardianUserId } });
    await app.close();
  });

  describe('happy path', () => {
    it('student initiates payment: server amount, safe response, adapter fed authoritative values', async () => {
      const invoice = await makeInvoice('4000');
      const before = calls.length;
      const res = await http
        .post(`/api/v1/fees/invoices/${invoice.id}/pay`)
        .set(auth(studentToken))
        // Tampering probe: an amount in the body must be ignored — the
        // endpoint accepts no body fields at all.
        .send({ amount: 1, currency: 'USD', studentId: 'someone-else' });
      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({
        attemptId: expect.any(String),
        status: 'PENDING',
        checkoutUrl: expect.stringContaining('https://'),
      });
      // No secrets / raw provider payloads in the response envelope.
      const raw = JSON.stringify(res.body);
      expect(raw).not.toMatch(/secret|api_key|merchant/i);

      const call = calls[before];
      expect(call.amount).toBe('4000'); // server-computed, not "1"
      expect(call.currency).toBe('PKR'); // not "USD"
      expect(call.orderRef).toBe(invoice.invoiceNo);
      expect(call.attemptId).toBe(res.body.data.attemptId);

      const attempt = await prisma.paymentAttempt.findUniqueOrThrow({
        where: { id: res.body.data.attemptId },
      });
      expect(attempt.status).toBe('PENDING');
      expect(attempt.providerRef).toMatch(/^track_/);
      expect(Number(attempt.amount)).toBe(4000);
      expect(attempt.collegeId).toBe(collegeId);

      // Nothing settled: no Payment row, invoice untouched.
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
      const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(inv.status).toBe('PENDING');

      // Audit: ids/amount only — no secrets, no checkout URLs, no email.
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'payments.attempt_initiated', targetId: invoice.id },
      });
      expect(audit.metadata).toEqual({
        attemptId: attempt.id,
        amount: '4000',
        provider: 'SAFEPAY',
      });
    });

    it('a prior partial manual payment reduces the frozen amount', async () => {
      const invoice = await makeInvoice('3000');
      await prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: '1200',
          method: 'CASH',
          paidAt: new Date(),
          recordedById: (
            await prisma.user.findFirstOrThrow({ where: { email: 'admin@campusos.dev' } })
          ).id,
        },
      });
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'PARTIAL' } });
      const res = await http
        .post(`/api/v1/fees/invoices/${invoice.id}/pay`)
        .set(auth(studentToken));
      expect(res.status).toBe(201);
      const attempt = await prisma.paymentAttempt.findUniqueOrThrow({
        where: { id: res.body.data.attemptId },
      });
      expect(Number(attempt.amount)).toBe(1800); // 3000 - 1200
    });
  });

  describe('authorization matrix', () => {
    it('other student 404, guardian/teacher/admin 403, anonymous 401', async () => {
      const invoice = await makeInvoice('500');
      expect(
        (
          await http
            .post(`/api/v1/fees/invoices/${invoice.id}/pay`)
            .set(auth(otherStudentToken))
        ).status,
      ).toBe(404); // existence not leaked
      for (const token of [guardianToken, teacherToken, adminToken]) {
        expect(
          (
            await http
              .post(`/api/v1/fees/invoices/${invoice.id}/pay`)
              .set(auth(token))
          ).status,
        ).toBe(403); // no payments.initiate grant
      }
      expect(
        (await http.post(`/api/v1/fees/invoices/${invoice.id}/pay`)).status,
      ).toBe(401);
      expect(
        (
          await http
            .post('/api/v1/fees/invoices/not-a-real-id/pay')
            .set(auth(studentToken))
        ).status,
      ).toBe(404);
    });
  });

  describe('invoice-state guards', () => {
    it('cancelled, fully paid and in-progress invoices are refused', async () => {
      const cancelled = await makeInvoice('100');
      await prisma.invoice.update({
        where: { id: cancelled.id },
        data: { status: 'CANCELLED' },
      });
      const c = await http
        .post(`/api/v1/fees/invoices/${cancelled.id}/pay`)
        .set(auth(studentToken));
      expect(c.status).toBe(400);
      expect(c.body.error.code).toBe('INVOICE_CANCELLED');

      const paid = await makeInvoice('100');
      await prisma.payment.create({
        data: {
          invoiceId: paid.id,
          amount: '100',
          method: 'CASH',
          paidAt: new Date(),
          recordedById: (
            await prisma.user.findFirstOrThrow({ where: { email: 'admin@campusos.dev' } })
          ).id,
        },
      });
      const p = await http
        .post(`/api/v1/fees/invoices/${paid.id}/pay`)
        .set(auth(studentToken));
      expect(p.status).toBe(400);
      expect(p.body.error.code).toBe('NOTHING_TO_PAY');

      const busy = await makeInvoice('700');
      expect(
        (
          await http
            .post(`/api/v1/fees/invoices/${busy.id}/pay`)
            .set(auth(studentToken))
        ).status,
      ).toBe(201);
      const dup = await http
        .post(`/api/v1/fees/invoices/${busy.id}/pay`)
        .set(auth(studentToken));
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('ATTEMPT_IN_PROGRESS');
    });
  });

  describe('gateway failure handling', () => {
    it('session-creation failure fails the attempt, settles nothing, and a retry works', async () => {
      const invoice = await makeInvoice('600');
      failNext = true;
      const res = await http
        .post(`/api/v1/fees/invoices/${invoice.id}/pay`)
        .set(auth(studentToken));
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('GATEWAY_ERROR');

      const attempts = await prisma.paymentAttempt.findMany({
        where: { invoiceId: invoice.id },
      });
      expect(attempts).toHaveLength(1);
      expect(attempts[0].status).toBe('FAILED');
      expect(attempts[0].failureCode).toBe('SESSION_CREATE_FAILED');
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);

      // FAILED attempt does not block a fresh try.
      const retry = await http
        .post(`/api/v1/fees/invoices/${invoice.id}/pay`)
        .set(auth(studentToken));
      expect(retry.status).toBe(201);
    });

    it('a duplicate provider reference cannot map to two attempts (DB unique backstop)', async () => {
      const a = await makeInvoice('50');
      const b = await makeInvoice('60');
      fixedRef = `track_${suffix}_dup`;
      const first = await http
        .post(`/api/v1/fees/invoices/${a.id}/pay`)
        .set(auth(studentToken));
      expect(first.status).toBe(201);
      const second = await http
        .post(`/api/v1/fees/invoices/${b.id}/pay`)
        .set(auth(studentToken));
      fixedRef = null;
      expect(second.status).toBe(502);
      const bAttempts = await prisma.paymentAttempt.findMany({
        where: { invoiceId: b.id },
      });
      expect(bAttempts).toHaveLength(1);
      expect(bAttempts[0].status).toBe('FAILED');
      expect(bAttempts[0].providerRef).toBeNull(); // ref stayed with attempt A
    });
  });

  describe('Safepay adapter unit behavior (no network)', () => {
    it('is FEATURE_DISABLED without env config and never leaks config in errors', async () => {
      const saved = { ...process.env };
      delete process.env.SAFEPAY_API_KEY;
      delete process.env.SAFEPAY_SECRET_KEY;
      const adapter = new SafepayAdapter();
      await expect(
        adapter.createCheckoutSession({
          attemptId: 'a',
          amount: '10.00',
          currency: 'PKR',
          orderRef: 'INV-1',
          redirectUrl: 'https://x/r',
          cancelUrl: 'https://x/c',
        }),
      ).rejects.toMatchObject({ response: { code: 'FEATURE_DISABLED' } });
      await expect(adapter.verifyPayment('track_x')).rejects.toMatchObject({
        response: { code: 'FEATURE_DISABLED' },
      });
      process.env = saved;
    });

    it('converts PKR to/from the lowest denomination (paisa) exactly', () => {
      expect(toLowestDenomination('3500')).toBe(350000);
      expect(toLowestDenomination('3500.50')).toBe(350050);
      expect(toLowestDenomination('0.01')).toBe(1);
      expect(fromLowestDenomination(350050)).toBe('3500.50');
      expect(fromLowestDenomination(600000)).toBe('6000.00');
    });
  });
});
