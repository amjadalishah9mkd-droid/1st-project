import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import {
  PAYMENT_GATEWAY,
  type PaymentGatewayAdapter,
} from '../src/payments/gateway.adapter';
import {
  toLowestDenomination,
  fromLowestDenomination,
} from '../src/payments/safepay.adapter';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M16-W2 — refund engine adversarial suite (docs/M16_REFUNDS_DESIGN.md §23).
 * Real PostgreSQL; provider behavior via a programmable capturing fake
 * behind PAYMENT_GATEWAY. Covers authz, tenancy, amount safety,
 * concurrency/CAS, state machine, RECORDED + PROVIDER flows, verify
 * recovery, D-5 net accounting, D-7 cancelled-invoice refunds, audit
 * hygiene and exactly-once notifications.
 */
describe('M16-W2 — refunds', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let studentProfileId: string;
  let studentUserId: string;
  let structureId: string;
  let adminToken: string;
  let accountantToken: string;
  let teacherToken: string;
  let studentToken: string;
  let guardianToken: string;
  let accountantUserId: string;
  let rivalCollegeId: string;
  let rivalPaymentId: string;
  let rivalAttemptId: string;
  const madeInvoiceIds: string[] = [];
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  // ── programmable provider fake ───────────────────────────────
  const gw = {
    refundCalls: [] as Array<{ providerRef: string; amount: string }>,
    createBehavior: 'success' as 'success' | 'throw',
    verifyBehavior: 'ok' as 'ok' | 'throw',
    /** simulated reporter refund records for the payment */
    providerRefunds: [] as Array<{ ref: string; amount: string }>,
    reset() {
      this.refundCalls = [];
      this.createBehavior = 'success';
      this.verifyBehavior = 'ok';
      this.providerRefunds = [];
    },
  };
  let refSeq = 0;
  const fakeGateway: PaymentGatewayAdapter = {
    provider: 'SAFEPAY',
    async createCheckoutSession() {
      throw new Error('not used in refunds spec');
    },
    async verifyPayment() {
      return { state: 'PENDING' as const, amount: '0.00', currency: 'PKR' };
    },
    verifyWebhookSignature: () => false,
    parseWebhookEvent: () => null,
    async createRefund(input) {
      gw.refundCalls.push({ providerRef: input.providerRef, amount: input.amount });
      if (gw.createBehavior === 'throw') {
        throw new Error('GATEWAY_ERROR (simulated)');
      }
      refSeq += 1;
      gw.providerRefunds.push({ ref: `refund_fake_${suffix}_${refSeq}`, amount: input.amount });
      return { state: 'PARTIALLY_REFUNDED' as const, refunds: [] };
    },
    async verifyRefund() {
      if (gw.verifyBehavior === 'throw') throw new Error('GATEWAY_ERROR (simulated)');
      return { state: 'PARTIALLY_REFUNDED' as const, refunds: [...gw.providerRefunds] };
    },
  };

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  let invoiceSeq = 0;
  async function makeInvoiceWithPayment(opts: {
    invoiceAmount: string;
    paymentAmount: string;
    method?: 'CASH' | 'ONLINE';
    providerRef?: string;
    invoiceStatus?: 'PAID' | 'PARTIAL' | 'CANCELLED';
  }) {
    invoiceSeq += 1;
    const invoice = await prisma.invoice.create({
      data: {
        collegeId,
        studentId: studentProfileId,
        structureId,
        invoiceNo: `W2RF-${suffix}-${invoiceSeq}`,
        amount: opts.invoiceAmount,
        dueDate: new Date('2027-03-31'),
        status: opts.invoiceStatus ?? 'PAID',
      },
    });
    madeInvoiceIds.push(invoice.id);
    const payment = await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amount: opts.paymentAmount,
        method: opts.method ?? 'CASH',
        paidAt: new Date(),
        reference: opts.providerRef ?? null,
      },
    });
    if (opts.method === 'ONLINE') {
      await prisma.paymentAttempt.create({
        data: {
          collegeId,
          invoiceId: invoice.id,
          initiatedById: studentUserId,
          amount: opts.paymentAmount,
          provider: 'SAFEPAY',
          providerRef: opts.providerRef ?? `track_${suffix}_${invoiceSeq}`,
          status: 'SUCCEEDED',
          paymentId: payment.id,
          confirmedAt: new Date(),
        },
      });
    }
    return { invoice, payment };
  }

  const createRefund = (
    token: string,
    paymentId: string,
    body: Record<string, unknown>,
  ) =>
    http
      .post(`/api/v1/fees/payments/${paymentId}/refunds`)
      .set(auth(token))
      .send({ currency: 'PKR', method: 'RECORDED', reason: 'test refund', ...body });

  const executeRefund = (token: string, attemptId: string, confirmAmount: string) =>
    http
      .post(`/api/v1/fees/refunds/${attemptId}/execute`)
      .set(auth(token))
      .send({ confirmAmount });

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
    accountantUserId = (
      await prisma.user.findFirstOrThrow({
        where: { email: 'accountant@campusos.dev' },
      })
    ).id;

    // Guardian principal (guardians onboard by invite in demo — create one).
    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    await prisma.user.upsert({
      where: {
        collegeId_email: { collegeId, email: `w2rf-guardian-${suffix}@campusos.dev` },
      },
      update: {},
      create: {
        collegeId,
        email: `w2rf-guardian-${suffix}@campusos.dev`,
        passwordHash: admin.passwordHash,
        role: 'GUARDIAN',
        status: 'ACTIVE',
        firstName: 'Wtwo',
        lastName: 'Guardian',
        mustChangePassword: false,
      },
    });

    // Rival college fixture: invoice + payment + refund attempt.
    const rival = await prisma.college.create({
      data: { name: 'Rival Refund College', code: `RVRF-${suffix}` },
    });
    rivalCollegeId = rival.id;
    const rivalUser = await prisma.user.create({
      data: {
        collegeId: rival.id,
        email: `rvrf-admin-${suffix}@rival.dev`,
        passwordHash: admin.passwordHash,
        role: 'ADMIN',
        status: 'ACTIVE',
        firstName: 'Rival',
        lastName: 'Admin',
        mustChangePassword: false,
      },
    });
    const rivalStudentUser = await prisma.user.create({
      data: {
        collegeId: rival.id,
        email: `rvrf-stud-${suffix}@rival.dev`,
        passwordHash: admin.passwordHash,
        role: 'STUDENT',
        status: 'ACTIVE',
        firstName: 'Rival',
        lastName: 'Student',
        mustChangePassword: false,
      },
    });
    const rivalDept = await prisma.department.create({
      data: { collegeId: rival.id, code: `RD-${suffix}`.slice(0, 10), name: 'Rival Dept' },
    });
    const rivalProfile = await prisma.studentProfile.create({
      data: {
        collegeId: rival.id,
        userId: rivalStudentUser.id,
        departmentId: rivalDept.id,
        rollNo: `RV-${suffix}`,
        admissionNo: `RVADM-${suffix}`,
        batch: '2026',
      },
    });
    const rivalYear = await prisma.academicYear.create({
      data: {
        collegeId: rival.id,
        label: `RVRF-AY-${suffix}`,
        startsOn: new Date('2026-08-01'),
        endsOn: new Date('2027-06-30'),
      },
    });
    const rivalTerm = await prisma.term.create({
      data: {
        collegeId: rival.id,
        academicYearId: rivalYear.id,
        label: `RVRF-T-${suffix}`,
        startsOn: new Date('2026-08-01'),
        endsOn: new Date('2026-12-20'),
      },
    });
    const rivalStructure = await prisma.feeStructure.create({
      data: {
        collegeId: rival.id,
        termId: rivalTerm.id,
        name: `RVRF structure ${suffix}`,
        totalAmount: '400.00',
      },
    });
    const rivalInvoice = await prisma.invoice.create({
      data: {
        collegeId: rival.id,
        studentId: rivalProfile.id,
        structureId: rivalStructure.id,
        invoiceNo: `RVRF-${suffix}`,
        amount: '400.00',
        dueDate: new Date('2027-01-31'),
        status: 'PAID',
      },
    });
    const rivalPayment = await prisma.payment.create({
      data: {
        invoiceId: rivalInvoice.id,
        amount: '400.00',
        method: 'CASH',
        paidAt: new Date(),
        recordedById: rivalUser.id,
      },
    });
    rivalPaymentId = rivalPayment.id;
    rivalAttemptId = (
      await prisma.refundAttempt.create({
        data: {
          collegeId: rival.id,
          paymentId: rivalPayment.id,
          invoiceId: rivalInvoice.id,
          amount: '50.00',
          reason: 'rival refund',
          method: 'RECORDED',
          requestedById: rivalUser.id,
        },
      })
    ).id;

    adminToken = await login('admin@campusos.dev');
    accountantToken = await login('accountant@campusos.dev');
    teacherToken = await login('teacher@campusos.dev');
    studentToken = await login('student@campusos.dev');
    guardianToken = await login(`w2rf-guardian-${suffix}@campusos.dev`);
  });

  afterAll(async () => {
    await prisma.refundAttempt.deleteMany({
      where: { OR: [{ invoiceId: { in: madeInvoiceIds } }, { collegeId: rivalCollegeId }] },
    });
    // M20-W1: issued documents Restrict money-row deletion — clear them first.
    await prisma.financeDocument.deleteMany({ where: { invoiceId: { in: madeInvoiceIds } } });
    await prisma.financeDocument.deleteMany({ where: { payment: { id: rivalPaymentId } } });
    await prisma.refund.deleteMany({ where: { invoiceId: { in: madeInvoiceIds } } });
    await prisma.refund.deleteMany({ where: { payment: { id: rivalPaymentId } } });
    await prisma.paymentAttempt.deleteMany({
      where: { invoiceId: { in: madeInvoiceIds } },
    });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: madeInvoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: madeInvoiceIds } } });
    await prisma.notification.deleteMany({
      where: { type: { in: ['refund.succeeded', 'refund.failed'] } },
    });
    await prisma.payment.deleteMany({ where: { invoice: { collegeId: rivalCollegeId } } });
    await prisma.invoice.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.feeStructure.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.term.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.academicYear.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.studentProfile.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.department.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.auditLog.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.user.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.user.deleteMany({
      where: { email: `w2rf-guardian-${suffix}@campusos.dev` },
    });
    await prisma.college.delete({ where: { id: rivalCollegeId } });
    await app.close();
  });

  beforeEach(() => gw.reset());

  describe('authorization', () => {
    it('teacher/student/guardian 403 and anonymous 401 on every refund surface', async () => {
      const { payment } = await makeInvoiceWithPayment({
        invoiceAmount: '100.00',
        paymentAmount: '100.00',
      });
      for (const token of [teacherToken, studentToken, guardianToken]) {
        expect((await createRefund(token, payment.id, { amount: 10 })).status).toBe(403);
        expect((await executeRefund(token, 'x', '10.00')).status).toBe(403);
        expect(
          (await http.post('/api/v1/fees/refunds/x/cancel').set(auth(token)).send({}))
            .status,
        ).toBe(403);
        expect(
          (await http.post('/api/v1/fees/refunds/x/verify').set(auth(token)).send({}))
            .status,
        ).toBe(403);
        expect(
          (await http.get('/api/v1/fees/refunds').set(auth(token))).status,
        ).toBe(403);
      }
      expect(
        (await http.post(`/api/v1/fees/payments/${payment.id}/refunds`).send({}))
          .status,
      ).toBe(401);
      expect((await http.get('/api/v1/fees/refunds')).status).toBe(401);
    });
  });

  describe('tenancy', () => {
    it('rival payment/attempt ids are invisible on every surface; zero rows created', async () => {
      expect(
        (await createRefund(adminToken, rivalPaymentId, { amount: 10 })).status,
      ).toBe(404);
      expect((await executeRefund(adminToken, rivalAttemptId, '50.00')).status).toBe(404);
      expect(
        (
          await http
            .post(`/api/v1/fees/refunds/${rivalAttemptId}/cancel`)
            .set(auth(adminToken))
            .send({})
        ).status,
      ).toBe(404);
      expect(
        (
          await http
            .post(`/api/v1/fees/refunds/${rivalAttemptId}/verify`)
            .set(auth(adminToken))
            .send({})
        ).status,
      ).toBe(404);
      expect(
        (
          await http
            .get(`/api/v1/fees/payments/${rivalPaymentId}/refunds`)
            .set(auth(accountantToken))
        ).status,
      ).toBe(404);
      // rival attempt untouched; no cross-tenant refund rows exist
      const rivalAttempt = await prisma.refundAttempt.findUniqueOrThrow({
        where: { id: rivalAttemptId },
      });
      expect(rivalAttempt.status).toBe('REQUESTED');
      expect(await prisma.refund.count({ where: { paymentId: rivalPaymentId } })).toBe(0);
      // listing never leaks the rival attempt
      const list = await http.get('/api/v1/fees/refunds').set(auth(adminToken));
      expect(list.status).toBe(200);
      expect(
        (list.body.data as Array<{ id: string }>).some((r) => r.id === rivalAttemptId),
      ).toBe(false);
    });
  });

  describe('amount safety', () => {
    it('zero, negative, non-PKR, missing reason and over-payment amounts are rejected', async () => {
      const { payment } = await makeInvoiceWithPayment({
        invoiceAmount: '200.00',
        paymentAmount: '200.00',
      });
      expect((await createRefund(adminToken, payment.id, { amount: 0 })).status).toBe(400);
      expect((await createRefund(adminToken, payment.id, { amount: -5 })).status).toBe(400);
      expect(
        (await createRefund(adminToken, payment.id, { amount: 10, currency: 'USD' }))
          .status,
      ).toBe(400);
      expect(
        (await createRefund(adminToken, payment.id, { amount: 10, reason: '' })).status,
      ).toBe(400);
      const over = await createRefund(adminToken, payment.id, { amount: 250 });
      expect(over.status).toBe(400);
      expect(over.body.error.code).toBe('EXCEEDS_REFUNDABLE');
    });

    it('D-5 net accounting: 800 paid, 300 refund → PARTIAL(500); +500 → PENDING(0); exhaustion rejected', async () => {
      const { invoice, payment } = await makeInvoiceWithPayment({
        invoiceAmount: '800.00',
        paymentAmount: '800.00',
      });
      // refund 300
      const r1 = await createRefund(accountantToken, payment.id, { amount: 300 });
      expect(r1.status).toBe(201);
      expect(
        (await executeRefund(accountantToken, r1.body.data.id, '300.00')).status,
      ).toBe(201);
      let inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(inv.status).toBe('PARTIAL');
      // list endpoint shows net paid
      const summary1 = await http
        .get(`/api/v1/fees/payments/${payment.id}/refunds`)
        .set(auth(accountantToken));
      expect(summary1.body.data.refundable).toBe('500.00');
      // refund exact remaining 500
      const r2 = await createRefund(accountantToken, payment.id, { amount: 500 });
      expect(r2.status).toBe(201);
      expect(
        (await executeRefund(accountantToken, r2.body.data.id, '500')).status,
      ).toBe(201); // numeric-equal confirmation accepted
      inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(inv.status).toBe('PENDING'); // net 0 → PENDING (D-5)
      // exhausted
      const r3 = await createRefund(accountantToken, payment.id, { amount: 1 });
      expect(r3.status).toBe(400);
      expect(r3.body.error.code).toBe('EXCEEDS_REFUNDABLE');
      // immutable financials: payment/invoice amounts untouched
      const pay = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(pay.amount.toString()).toBe('800');
      expect(inv.amount.toString()).toBe('800');
    });

    it('partial payment: 800 invoice, 500 paid, 300 refund → net 200 → PARTIAL', async () => {
      const { invoice, payment } = await makeInvoiceWithPayment({
        invoiceAmount: '800.00',
        paymentAmount: '500.00',
        invoiceStatus: 'PARTIAL',
      });
      const r = await createRefund(adminToken, payment.id, { amount: 300 });
      expect((await executeRefund(adminToken, r.body.data.id, '300.00')).status).toBe(201);
      const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(inv.status).toBe('PARTIAL');
      const summary = await http
        .get(`/api/v1/fees/payments/${payment.id}/refunds`)
        .set(auth(adminToken));
      expect(summary.body.data.refunded).toBe('300.00');
      expect(summary.body.data.refundable).toBe('200.00');
    });

    it('D-7: a payment on a CANCELLED invoice is refundable; the invoice stays CANCELLED', async () => {
      const { invoice, payment } = await makeInvoiceWithPayment({
        invoiceAmount: '100.00',
        paymentAmount: '100.00',
        invoiceStatus: 'CANCELLED',
      });
      const r = await createRefund(accountantToken, payment.id, { amount: 100 });
      expect(r.status).toBe(201);
      expect(
        (await executeRefund(accountantToken, r.body.data.id, '100.00')).status,
      ).toBe(201);
      const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(inv.status).toBe('CANCELLED');
      expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(1);
    });

    it('headroom is re-checked at execution: money moved after creation blocks the execute', async () => {
      const { invoice, payment } = await makeInvoiceWithPayment({
        invoiceAmount: '600.00',
        paymentAmount: '600.00',
      });
      const r = await createRefund(adminToken, payment.id, { amount: 500 });
      expect(r.status).toBe(201);
      // Another settled refund lands before execution (out-of-band).
      await prisma.refund.create({
        data: {
          paymentId: payment.id,
          invoiceId: invoice.id,
          amount: new Prisma.Decimal('400.00'),
          method: 'RECORDED',
          refundedAt: new Date(),
        },
      });
      const exec = await executeRefund(adminToken, r.body.data.id, '500.00');
      expect(exec.status).toBe(400);
      expect(exec.body.error.code).toBe('EXCEEDS_REFUNDABLE');
      // attempt still REQUESTED — cancellable, nothing settled
      const attempt = await prisma.refundAttempt.findUniqueOrThrow({
        where: { id: r.body.data.id },
      });
      expect(attempt.status).toBe('REQUESTED');
      expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(1);
    });
  });

  describe('state machine & typed confirmation', () => {
    it('wrong typed confirmation is refused server-side; nothing changes', async () => {
      const { payment } = await makeInvoiceWithPayment({
        invoiceAmount: '100.00',
        paymentAmount: '100.00',
      });
      const r = await createRefund(adminToken, payment.id, { amount: 40 });
      const bad = await executeRefund(adminToken, r.body.data.id, '41.00');
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('CONFIRMATION_MISMATCH');
      const attempt = await prisma.refundAttempt.findUniqueOrThrow({
        where: { id: r.body.data.id },
      });
      expect(attempt.status).toBe('REQUESTED');
      expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(0);
    });

    it('forbidden transitions: terminal attempts cannot be executed, cancelled or re-run', async () => {
      const { payment } = await makeInvoiceWithPayment({
        invoiceAmount: '100.00',
        paymentAmount: '100.00',
      });
      const r = await createRefund(adminToken, payment.id, { amount: 30 });
      const attemptId = r.body.data.id as string;
      expect((await executeRefund(adminToken, attemptId, '30.00')).status).toBe(201);
      // SUCCEEDED → anything is refused
      expect((await executeRefund(adminToken, attemptId, '30.00')).status).toBe(409);
      expect(
        (
          await http
            .post(`/api/v1/fees/refunds/${attemptId}/cancel`)
            .set(auth(adminToken))
            .send({})
        ).status,
      ).toBe(409);
      // exactly one Refund row exists
      expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(1);

      // CANCELLED is terminal too
      const r2 = await createRefund(adminToken, payment.id, { amount: 10 });
      const cancel = await http
        .post(`/api/v1/fees/refunds/${r2.body.data.id}/cancel`)
        .set(auth(adminToken))
        .send({ reason: 'changed mind' });
      expect(cancel.status).toBe(201);
      expect(cancel.body.data.status).toBe('CANCELLED');
      expect((await executeRefund(adminToken, r2.body.data.id, '10.00')).status).toBe(409);
      // cancellation settled nothing
      expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(1);
    });

    it('retry after FAILED creates a new attempt (in-flight slot freed)', async () => {
      const { payment } = await makeInvoiceWithPayment({
        invoiceAmount: '100.00',
        paymentAmount: '100.00',
      });
      const r = await createRefund(adminToken, payment.id, { amount: 20 });
      await prisma.refundAttempt.update({
        where: { id: r.body.data.id },
        data: { status: 'FAILED', failureCode: 'PROVIDER_REJECTED' },
      });
      const retry = await createRefund(adminToken, payment.id, { amount: 20 });
      expect(retry.status).toBe(201);
      expect(retry.body.data.id).not.toBe(r.body.data.id);
    });
  });

  describe('concurrency (real DB, true races)', () => {
    it('simultaneous creates collapse to one 201 + one 409 (partial unique index)', async () => {
      const { payment } = await makeInvoiceWithPayment({
        invoiceAmount: '300.00',
        paymentAmount: '300.00',
      });
      const [a, b] = await Promise.all([
        createRefund(adminToken, payment.id, { amount: 100 }),
        createRefund(accountantToken, payment.id, { amount: 100 }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const conflict = a.status === 409 ? a : b;
      expect(conflict.body.error.code).toBe('REFUND_IN_PROGRESS');
      expect(
        await prisma.refundAttempt.count({
          where: { paymentId: payment.id, status: { in: ['REQUESTED', 'PROCESSING'] } },
        }),
      ).toBe(1);
    });

    it('simultaneous executes: exactly one transition, exactly one Refund row', async () => {
      const { payment } = await makeInvoiceWithPayment({
        invoiceAmount: '300.00',
        paymentAmount: '300.00',
      });
      const r = await createRefund(adminToken, payment.id, { amount: 150 });
      const attemptId = r.body.data.id as string;
      const results = await Promise.all([
        executeRefund(adminToken, attemptId, '150.00'),
        executeRefund(accountantToken, attemptId, '150.00'),
      ]);
      expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
      expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(1);
      const audits = await prisma.auditLog.count({
        where: {
          action: 'payments.refund_succeeded',
          metadata: { path: ['attemptId'], equals: attemptId },
        },
      });
      expect(audits).toBe(1);
    });
  });

  describe('RECORDED refunds', () => {
    it('CASH and BANK-settled payments refund without any provider call', async () => {
      for (const method of ['CASH', 'ONLINE'] as const) {
        const { payment } = await makeInvoiceWithPayment({
          invoiceAmount: '100.00',
          paymentAmount: '100.00',
          method,
          providerRef: method === 'ONLINE' ? `track_rec_${suffix}_${method}` : undefined,
        });
        const r = await createRefund(accountantToken, payment.id, {
          amount: 60,
          method: 'RECORDED',
        });
        expect(r.status).toBe(201);
        const exec = await executeRefund(accountantToken, r.body.data.id, '60.00');
        expect(exec.status).toBe(201);
        expect(exec.body.data.status).toBe('SUCCEEDED');
        const refund = await prisma.refund.findFirstOrThrow({
          where: { paymentId: payment.id },
        });
        expect(refund.method).toBe('RECORDED');
        expect(refund.amount.toString()).toBe('60');
        expect(refund.recordedById).toBeTruthy();
      }
      expect(gw.refundCalls).toHaveLength(0); // zero provider involvement
    });
  });

  describe('PROVIDER refunds (capturing fake)', () => {
    async function makeOnlinePayment(amount = '200.00') {
      invoiceSeq += 1;
      return makeInvoiceWithPayment({
        invoiceAmount: amount,
        paymentAmount: amount,
        method: 'ONLINE',
        providerRef: `track_prov_${suffix}_${invoiceSeq}`,
      });
    }

    it('PROVIDER method is refused for non-gateway payments', async () => {
      const { payment } = await makeInvoiceWithPayment({
        invoiceAmount: '50.00',
        paymentAmount: '50.00',
        method: 'CASH',
      });
      const res = await createRefund(adminToken, payment.id, {
        amount: 10,
        method: 'PROVIDER',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PROVIDER_UNAVAILABLE');
    });

    it('success: adapter called with frozen amount; provider ref captured; Refund materialized', async () => {
      const { payment } = await makeOnlinePayment();
      const r = await createRefund(adminToken, payment.id, {
        amount: 75.5,
        method: 'PROVIDER',
      });
      expect(r.status).toBe(201);
      const exec = await executeRefund(adminToken, r.body.data.id, '75.50');
      expect(exec.status).toBe(201);
      expect(exec.body.data.status).toBe('SUCCEEDED');
      expect(exec.body.data.providerRefundRef).toMatch(/^refund_fake_/);
      expect(gw.refundCalls).toEqual([
        { providerRef: expect.stringMatching(/^track_prov_/), amount: '75.50' },
      ]);
      const refund = await prisma.refund.findFirstOrThrow({
        where: { paymentId: payment.id },
      });
      expect(refund.method).toBe('PROVIDER');
      expect(refund.reference).toBe(exec.body.data.providerRefundRef);
      expect(refund.recordedById).toBeNull();
    });

    it('provider rejection (reporter shows no refund) → FAILED PROVIDER_REJECTED; retry allowed', async () => {
      const { payment } = await makeOnlinePayment();
      gw.createBehavior = 'throw'; // call rejected; reporter reachable, empty
      const r = await createRefund(adminToken, payment.id, {
        amount: 50,
        method: 'PROVIDER',
      });
      const exec = await executeRefund(adminToken, r.body.data.id, '50.00');
      expect(exec.status).toBe(201);
      expect(exec.body.data.status).toBe('FAILED');
      expect(exec.body.data.failureCode).toBe('PROVIDER_REJECTED');
      expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(0);
      // retry = new attempt
      gw.createBehavior = 'success';
      const retry = await createRefund(adminToken, payment.id, {
        amount: 50,
        method: 'PROVIDER',
      });
      expect(retry.status).toBe(201);
    });

    it('ambiguous timeout (call AND reporter unreachable) stays PROCESSING; verify recovers to SUCCEEDED', async () => {
      const { payment } = await makeOnlinePayment();
      gw.createBehavior = 'throw';
      gw.verifyBehavior = 'throw';
      const r = await createRefund(accountantToken, payment.id, {
        amount: 80,
        method: 'PROVIDER',
      });
      const exec = await executeRefund(accountantToken, r.body.data.id, '80.00');
      expect(exec.status).toBe(201);
      expect(exec.body.data.status).toBe('PROCESSING'); // money-safety: never FAILED on ambiguity
      expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(0);

      // The refund actually applied provider-side; reporter comes back.
      gw.verifyBehavior = 'ok';
      gw.providerRefunds.push({ ref: `refund_fake_${suffix}_recover`, amount: '80.00' });
      const verify = await http
        .post(`/api/v1/fees/refunds/${r.body.data.id}/verify`)
        .set(auth(accountantToken))
        .send({});
      expect(verify.status).toBe(201);
      expect(verify.body.data.status).toBe('SUCCEEDED');
      expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(1);

      // Replayed verification: no duplicates of anything.
      const replay = await http
        .post(`/api/v1/fees/refunds/${r.body.data.id}/verify`)
        .set(auth(accountantToken))
        .send({});
      expect(replay.status).toBe(201);
      expect(replay.body.data.status).toBe('SUCCEEDED');
      expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(1);
      const audits = await prisma.auditLog.count({
        where: {
          action: 'payments.refund_succeeded',
          metadata: { path: ['attemptId'], equals: r.body.data.id },
        },
      });
      expect(audits).toBe(1);
      // exactly-once notification FOR THIS attempt's invoice (other tests
      // in this suite also notify the same demo student).
      const attemptRow = await prisma.refundAttempt.findUniqueOrThrow({
        where: { id: r.body.data.id },
      });
      const notifications = await prisma.notification.count({
        where: {
          type: 'refund.succeeded',
          userId: studentUserId,
          linkPath: `/fees/invoices/${attemptRow.invoiceId}`,
        },
      });
      expect(notifications).toBe(1);
    });

    it('provider amount mismatch → FAILED AMOUNT_MISMATCH, zero Refund rows, invoice untouched', async () => {
      const { invoice, payment } = await makeOnlinePayment();
      gw.createBehavior = 'throw';
      gw.providerRefunds.push({ ref: `refund_fake_${suffix}_wrong`, amount: '99.99' });
      const r = await createRefund(adminToken, payment.id, {
        amount: 60,
        method: 'PROVIDER',
      });
      const exec = await executeRefund(adminToken, r.body.data.id, '60.00');
      expect(exec.body.data.status).toBe('FAILED');
      expect(exec.body.data.failureCode).toBe('AMOUNT_MISMATCH');
      expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(0);
      const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(inv.status).toBe('PAID');
      // exactly-once failure side effects
      const failedNotifications = await prisma.notification.count({
        where: { type: 'refund.failed' },
      });
      expect(failedNotifications).toBeGreaterThanOrEqual(1);
      const audits = await prisma.auditLog.count({
        where: {
          action: 'payments.refund_failed',
          metadata: { path: ['attemptId'], equals: r.body.data.id },
        },
      });
      expect(audits).toBe(1);
    });

    it('a provider refund record already claimed by another attempt is never reused', async () => {
      const { payment } = await makeOnlinePayment('300.00');
      // First provider refund of 100 succeeds and claims its ref.
      const r1 = await createRefund(adminToken, payment.id, {
        amount: 100,
        method: 'PROVIDER',
      });
      expect((await executeRefund(adminToken, r1.body.data.id, '100.00')).status).toBe(201);
      const claimedRef = (
        await prisma.refundAttempt.findUniqueOrThrow({ where: { id: r1.body.data.id } })
      ).providerRefundRef!;
      // Second attempt for the SAME amount: provider call "fails", reporter
      // still lists only the claimed record → must NOT match it again.
      gw.createBehavior = 'throw';
      const r2 = await createRefund(adminToken, payment.id, {
        amount: 100,
        method: 'PROVIDER',
      });
      const exec2 = await executeRefund(adminToken, r2.body.data.id, '100.00');
      expect(exec2.body.data.status).toBe('FAILED'); // PROVIDER_REJECTED, not a false success
      expect(exec2.body.data.providerRefundRef).not.toBe(claimedRef);
      expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(1);
    });
  });

  describe('money units (adapter boundary)', () => {
    it('paisa conversion vectors match the LIVE-VERIFIED contract', () => {
      expect(toLowestDenomination('0.01')).toBe(1);
      expect(toLowestDenomination('800.00')).toBe(80000);
      expect(toLowestDenomination('75.50')).toBe(7550);
      expect(fromLowestDenomination(80000)).toBe('800.00');
      expect(fromLowestDenomination(1)).toBe('0.01');
      expect(fromLowestDenomination(30000)).toBe('300.00');
    });
  });

  describe('M16-W5 — refunds.csv export', () => {
    let csvPaymentId: string;
    let csvInvoiceNo: string;

    beforeAll(async () => {
      const { invoice, payment } = await makeInvoiceWithPayment({
        invoiceAmount: '120.00',
        paymentAmount: '120.00',
      });
      csvPaymentId = payment.id;
      csvInvoiceNo = invoice.invoiceNo;
      // Reason exercises CSV escaping: comma, quotes and a newline.
      const create = await http
        .post(`/api/v1/fees/payments/${payment.id}/refunds`)
        .set(auth(accountantToken))
        .send({
          amount: 45,
          currency: 'PKR',
          reason: 'duplicate, "double-charged"\nsecond line',
          method: 'RECORDED',
        });
      expect(create.status).toBe(201);
      expect(
        (await executeRefund(accountantToken, create.body.data.id, '45.00')).status,
      ).toBe(201);
    });

    it('accountant and admin export; student/teacher/anonymous are refused', async () => {
      for (const token of [accountantToken, adminToken]) {
        const res = await http.get('/api/v1/exports/refunds.csv').set(auth(token));
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
      }
      expect(
        (await http.get('/api/v1/exports/refunds.csv').set(auth(studentToken))).status,
      ).toBe(403);
      expect(
        (await http.get('/api/v1/exports/refunds.csv').set(auth(teacherToken))).status,
      ).toBe(403);
      expect((await http.get('/api/v1/exports/refunds.csv')).status).toBe(401);
    });

    it('rows are tenant-scoped, exactly two-decimal, escaped, and filterable', async () => {
      const res = await http
        .get('/api/v1/exports/refunds.csv?status=SUCCEEDED')
        .set(auth(accountantToken));
      expect(res.status).toBe(200);
      const body = res.text;
      // header intact
      expect(body.startsWith('attemptId,refundId,invoiceNo,paymentId,amount')).toBe(true);
      // exact PKR two-decimal representation
      expect(body).toContain(',45.00,PKR,RECORDED,SUCCEEDED,');
      // RFC-4180 escaping: quoted cell with doubled quotes, comma and newline preserved
      expect(body).toContain('"duplicate, ""double-charged""\nsecond line"');
      // requester name present per finance-export convention
      expect(body).toContain('Bilal Hussain');
      // rival-college attempt never appears
      expect(body).not.toContain(rivalAttemptId);
      // status filter semantics match the reconciliation view
      const requestedOnly = await http
        .get('/api/v1/exports/refunds.csv?status=REQUESTED')
        .set(auth(accountantToken));
      expect(requestedOnly.text).not.toContain(csvPaymentId);
    });

    it('an unmatched filter still returns a valid header-only CSV', async () => {
      const res = await http
        .get('/api/v1/exports/refunds.csv?status=PROCESSING&method=PROVIDER')
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      const lines = res.text.trim().split('\r\n');
      expect(lines).toHaveLength(1); // header only
    });

    it('fees.csv paid column is NET of settled refunds (D-5 across exports)', async () => {
      const res = await http
        .get('/api/v1/exports/fees.csv')
        .set(auth(accountantToken));
      expect(res.status).toBe(200);
      // the 120 invoice with a 120 payment and 45 refund exports paid=75
      const line = res.text
        .split('\r\n')
        .find((row) => row.startsWith(csvInvoiceNo));
      expect(line).toBeDefined();
      expect(line).toContain(',75,');
    });
  });

  describe('audit hygiene & listings', () => {
    it('refund audit metadata carries ids/amounts/codes only — no PII, no reason text', async () => {
      const rows = await prisma.auditLog.findMany({
        where: {
          action: {
            in: [
              'payments.refund_requested',
              'payments.refund_succeeded',
              'payments.refund_failed',
              'payments.refund_cancelled',
            ],
          },
        },
      });
      expect(rows.length).toBeGreaterThan(0);
      const allowed = new Set(['attemptId', 'refundId', 'amount', 'method', 'failureCode']);
      for (const row of rows) {
        const metadata = row.metadata as Record<string, unknown>;
        for (const key of Object.keys(metadata)) {
          expect(allowed.has(key)).toBe(true);
        }
        expect(JSON.stringify(metadata)).not.toContain('test refund');
      }
    });

    it('reconciliation listing filters by status and stays tenant-scoped; student summary is OWN-scoped', async () => {
      const list = await http
        .get('/api/v1/fees/refunds?status=SUCCEEDED')
        .set(auth(accountantToken));
      expect(list.status).toBe(200);
      expect(list.body.data.length).toBeGreaterThan(0);
      for (const row of list.body.data as Array<{ status: string }>) {
        expect(row.status).toBe('SUCCEEDED');
      }
      // student can read refund history of THEIR OWN payment…
      const { payment } = await makeInvoiceWithPayment({
        invoiceAmount: '10.00',
        paymentAmount: '10.00',
      });
      const own = await http
        .get(`/api/v1/fees/payments/${payment.id}/refunds`)
        .set(auth(studentToken));
      expect(own.status).toBe(200);
      expect(own.body.data.refundable).toBe('10.00');
      // M17-W3 (D-5): a guardian LINKED to the student reads the summary
      // (CHILD scope, read-only); an UNLINKED guardian stays 404.
      const guardianUser = await prisma.user.findFirstOrThrow({
        where: { email: `w2rf-guardian-${suffix}@campusos.dev` },
      });
      const unlinked = await http
        .get(`/api/v1/fees/payments/${payment.id}/refunds`)
        .set(auth(guardianToken));
      expect(unlinked.status).toBe(404);
      const link = await prisma.guardianLink.create({
        data: {
          collegeId,
          guardianUserId: guardianUser.id,
          studentProfileId,
          relationship: 'parent',
          status: 'ACTIVE',
        },
      });
      const linked = await http
        .get(`/api/v1/fees/payments/${payment.id}/refunds`)
        .set(auth(guardianToken));
      expect(linked.status).toBe(200);
      expect(linked.body.data.refundable).toBe('10.00');
      // strictly read-only: mutations remain 403 for guardians
      expect(
        (await createRefund(guardianToken, payment.id, { amount: 1 })).status,
      ).toBe(403);
      await prisma.guardianLink.delete({ where: { id: link.id } });

      // …but not another student's / rival's
      const foreign = await http
        .get(`/api/v1/fees/payments/${rivalPaymentId}/refunds`)
        .set(auth(studentToken));
      expect(foreign.status).toBe(404);
    });
  });
});
