import { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { MAIL_TRANSPORT } from '../src/mail/mail.module';
import {
  PAYMENT_GATEWAY,
  type GatewayVerification,
  type PaymentGatewayAdapter,
} from '../src/payments/gateway.adapter';
import { SafepayAdapter, toLowestDenomination } from '../src/payments/safepay.adapter';
import { ATTEMPT_TTL_MS } from '../src/payments/payments.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';
const WEBHOOK_SECRET = 'w3-test-webhook-secret';

/**
 * M14-W3 — webhook settlement + verify-on-return.
 * Signature scheme (VERIFIED from Safepay docs): X-SFPY-SIGNATURE =
 * HMAC-SHA512 hex of the raw JSON body. The fake gateway reuses the REAL
 * SafepayAdapter for signature verification and payload parsing (both
 * pure/env-driven), while stubbing the network methods.
 */
describe('M14-W3 — webhook settlement & verification', () => {
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
  let guardianUserId: string;
  let studentUserId: string;
  const madeInvoiceIds: string[] = [];

  const realParser = new SafepayAdapter();
  let verifyResult: GatewayVerification = {
    state: 'PENDING',
    amount: '0.00',
    currency: 'PKR',
  };
  let nextRef = 0;
  const fakeGateway: PaymentGatewayAdapter = {
    provider: 'SAFEPAY',
    async createCheckoutSession(input) {
      nextRef += 1;
      return {
        providerRef: `track_w3_${suffix}_${nextRef}`,
        checkoutUrl: `https://sandbox.api.getsafepay.com/embedded/?tracker=x`,
      };
    },
    async verifyPayment() {
      return verifyResult;
    },
    verifyWebhookSignature: (raw, sig) =>
      realParser.verifyWebhookSignature(raw, sig),
    parseWebhookEvent: (body) => realParser.parseWebhookEvent(body),
    // M16-W2 interface additions — unused by this spec.
    async createRefund() {
      throw new Error('refunds not used in this spec');
    },
    async verifyRefund() {
      return { state: 'PAID' as const, refunds: [] };
    },
  };

  const sentMail: string[] = [];
  let mailShouldFail = false;
  const failingTransport = {
    async sendMail(options: { to: string }) {
      if (mailShouldFail) throw new Error('SMTP down');
      sentMail.push(options.to);
      return { messageId: 'fake' };
    },
  };

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Sign a webhook payload exactly like Safepay (VERIFIED scheme). */
  function signed(payload: object): { raw: string; signature: string } {
    const raw = JSON.stringify(payload);
    const signature = createHmac('sha512', WEBHOOK_SECRET)
      .update(Buffer.from(raw))
      .digest('hex');
    return { raw, signature };
  }

  function successEvent(tracker: string, amountRupees: string, eventId?: string) {
    return {
      token: eventId ?? `evt_${suffix}_${Math.random().toString(36).slice(2)}`,
      version: '2.0.0',
      type: 'payment.succeeded',
      data: {
        tracker,
        state: 'TRACKER_ENDED',
        amount: toLowestDenomination(amountRupees),
        currency: 'PKR',
      },
    };
  }

  function failureEvent(tracker: string, eventId?: string) {
    return {
      token: eventId ?? `evt_${suffix}_${Math.random().toString(36).slice(2)}`,
      version: '2.0.0',
      type: 'payment.failed',
      data: { tracker, state: 'TRACKER_ENROLLED' },
    };
  }

  async function postWebhook(payload: object, signature?: string) {
    const raw = JSON.stringify(payload);
    const sig =
      signature ??
      createHmac('sha512', WEBHOOK_SECRET).update(Buffer.from(raw)).digest('hex');
    return http
      .post('/api/v1/payments/webhooks/safepay')
      .set('content-type', 'application/json')
      .set('x-sfpy-signature', sig)
      .send(raw);
  }

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
        invoiceNo: `W3-${suffix}-${invoiceSeq}`,
        amount,
        dueDate: new Date('2027-01-31'),
        status: 'PENDING',
      },
    });
    madeInvoiceIds.push(invoice.id);
    return invoice;
  }

  /** Initiate through the real endpoint; returns { invoice, attempt }. */
  async function initiated(amount: string) {
    const invoice = await makeInvoice(amount);
    const res = await http
      .post(`/api/v1/fees/invoices/${invoice.id}/pay`)
      .set(auth(studentToken));
    expect(res.status).toBe(201);
    const attempt = await prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: res.body.data.attemptId },
    });
    return { invoice, attempt };
  }

  function notifications(userId: string, type: string) {
    return prisma.notification.count({ where: { userId, type } });
  }

  beforeAll(async () => {
    process.env.SAFEPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.SMTP_URL = 'smtp://fake:fake@127.0.0.1:2525';
    process.env.MAIL_FROM = 'CampusOS <no-reply@campusos.dev>';
    app = await createTestApp([
      { token: PAYMENT_GATEWAY, value: fakeGateway },
      { token: MAIL_TRANSPORT, value: failingTransport },
    ]);
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
    const guardian = await prisma.user.create({
      data: {
        college: { connect: { id: collegeId } },
        email: `w3pay-g-${suffix}@campusos.dev`,
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        role: 'GUARDIAN',
        firstName: 'W3',
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

    studentToken = await login('student@campusos.dev');
    otherStudentToken = await login(otherProfile.user.email);
    guardianToken = await login(guardian.email);
  });

  afterAll(async () => {
    delete process.env.SAFEPAY_WEBHOOK_SECRET;
    delete process.env.SMTP_URL;
    delete process.env.MAIL_FROM;
    await prisma.gatewayEvent.deleteMany({});
    await prisma.paymentAttempt.deleteMany({
      where: { invoiceId: { in: madeInvoiceIds } },
    });
    // M20-W1: issued documents Restrict money-row deletion — clear them first.
    await prisma.financeDocument.deleteMany({ where: { invoiceId: { in: madeInvoiceIds } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: madeInvoiceIds } } });
    await prisma.notification.deleteMany({
      where: { type: { in: ['payment.succeeded', 'payment.failed'] } },
    });
    await prisma.invoice.deleteMany({ where: { id: { in: madeInvoiceIds } } });
    await prisma.guardianLink.deleteMany({ where: { guardianUserId } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: guardianUserId }, { targetId: guardianUserId }] },
    });
    await prisma.user.deleteMany({ where: { id: guardianUserId } });
    await app.close();
  });

  describe('webhook authentication', () => {
    it('unsigned / bad-signature / unconfigured-secret are indistinguishable 401s; nothing recorded', async () => {
      const { attempt } = await initiated('100');
      const payload = successEvent(attempt.providerRef!, '100');

      const unsigned = await http
        .post('/api/v1/payments/webhooks/safepay')
        .set('content-type', 'application/json')
        .send(JSON.stringify(payload));
      expect(unsigned.status).toBe(401);

      const badSig = await postWebhook(payload, 'a'.repeat(128));
      expect(badSig.status).toBe(401);

      const saved = process.env.SAFEPAY_WEBHOOK_SECRET;
      delete process.env.SAFEPAY_WEBHOOK_SECRET;
      const noSecret = await postWebhook(payload);
      process.env.SAFEPAY_WEBHOOK_SECRET = saved;
      expect(noSecret.status).toBe(401);

      expect(await prisma.gatewayEvent.count()).toBe(0);
      expect(await prisma.payment.count({ where: { invoiceId: attempt.invoiceId } })).toBe(0);
    });

    it('a tampered body fails the signature (signature covers exact raw bytes)', async () => {
      const { attempt } = await initiated('100');
      const { signature } = signed(successEvent(attempt.providerRef!, '100', 'evt_orig'));
      const tampered = JSON.stringify(
        successEvent(attempt.providerRef!, '99999', 'evt_orig'),
      );
      const res = await http
        .post('/api/v1/payments/webhooks/safepay')
        .set('content-type', 'application/json')
        .set('x-sfpy-signature', signature)
        .send(tampered);
      expect(res.status).toBe(401);
    });

    it('authentic but structurally invalid body → 400, no state change', async () => {
      const res = await postWebhook({ hello: 'world' });
      expect(res.status).toBe(400);
      expect(await prisma.gatewayEvent.count()).toBe(0);
    });
  });

  describe('webhook settlement', () => {
    it('verified success settles once: Payment(ONLINE, null recorder), invoice PAID, audit + notification exactly once', async () => {
      const { invoice, attempt } = await initiated('2500');
      const event = successEvent(attempt.providerRef!, '2500');

      const res = await postWebhook(event);
      expect(res.status).toBe(200);

      const payments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
      expect(payments).toHaveLength(1);
      expect(payments[0].method).toBe('ONLINE');
      expect(payments[0].recordedById).toBeNull();
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('PAID');

      // Replay: exact same event again.
      const replay = await postWebhook(event);
      expect(replay.status).toBe(200);
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
      expect(
        await prisma.gatewayEvent.count({ where: { eventId: event.token } }),
      ).toBe(1);
      expect(await notifications(studentUserId, 'payment.succeeded')).toBe(1);

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'payments.settled', targetId: invoice.id },
      });
      const meta = JSON.stringify(audit.metadata);
      expect(meta).not.toMatch(/@|secret|signature|track_|http/i);
    });

    it('parallel delivery of the SAME event settles exactly once', async () => {
      const { invoice, attempt } = await initiated('900');
      const event = successEvent(attempt.providerRef!, '900');
      const results = await Promise.all([
        postWebhook(event),
        postWebhook(event),
        postWebhook(event),
      ]);
      for (const r of results) expect(r.status).toBe(200);
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
      expect(await prisma.gatewayEvent.count({ where: { eventId: event.token } })).toBe(1);
    });

    it('parallel DISTINCT events for the same attempt settle exactly once (CAS)', async () => {
      const { invoice, attempt } = await initiated('800');
      const results = await Promise.all([
        postWebhook(successEvent(attempt.providerRef!, '800', `evt_${suffix}_d1`)),
        postWebhook(successEvent(attempt.providerRef!, '800', `evt_${suffix}_d2`)),
      ]);
      for (const r of results) expect(r.status).toBe(200);
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
      expect(await prisma.gatewayEvent.count({ where: { attemptId: attempt.id } })).toBe(2);
    });

    it('amount and currency mismatches fail the attempt, settle nothing, audit safely, notify failure once', async () => {
      const before = await notifications(studentUserId, 'payment.failed');
      const { invoice, attempt } = await initiated('1000');
      const res = await postWebhook(successEvent(attempt.providerRef!, '1'));
      expect(res.status).toBe(200); // business rejection, not a retry storm
      const after = await prisma.paymentAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      expect(after.status).toBe('FAILED');
      expect(after.failureCode).toBe('AMOUNT_MISMATCH');
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
      expect(
        await prisma.auditLog.count({
          where: { action: 'payments.webhook_rejected', targetId: attempt.id },
        }),
      ).toBe(1);
      expect(await notifications(studentUserId, 'payment.failed')).toBe(before + 1);

      // Currency mismatch on a fresh attempt.
      const second = await initiated('1000');
      const currencyEvent = successEvent(second.attempt.providerRef!, '1000');
      (currencyEvent.data as { currency: string }).currency = 'USD';
      await postWebhook(currencyEvent);
      const cAfter = await prisma.paymentAttempt.findUniqueOrThrow({
        where: { id: second.attempt.id },
      });
      expect(cAfter.status).toBe('FAILED');
      expect(await prisma.payment.count({ where: { invoiceId: second.invoice.id } })).toBe(0);
    });

    it('a FAILED attempt cannot be resurrected by a later valid success webhook', async () => {
      const { invoice, attempt } = await initiated('700');
      await postWebhook(failureEvent(attempt.providerRef!));
      expect(
        (await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
          .status,
      ).toBe('FAILED');
      const late = await postWebhook(successEvent(attempt.providerRef!, '700'));
      expect(late.status).toBe(200);
      expect(
        (await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
          .status,
      ).toBe('FAILED');
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
    });

    it('an EXPIRED attempt follows the W1 invariant: success webhook does not settle', async () => {
      const { invoice, attempt } = await initiated('600');
      await prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'EXPIRED',
          createdAt: new Date(Date.now() - ATTEMPT_TTL_MS - 60_000),
        },
      });
      const res = await postWebhook(successEvent(attempt.providerRef!, '600'));
      expect(res.status).toBe(200);
      expect(
        (await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
          .status,
      ).toBe('EXPIRED');
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
    });

    it('provider failure events are idempotent: one FAILED transition, one notification, no Payment', async () => {
      const before = await notifications(studentUserId, 'payment.failed');
      const { invoice, attempt } = await initiated('300');
      await postWebhook(failureEvent(attempt.providerRef!));
      await postWebhook(failureEvent(attempt.providerRef!)); // distinct event id
      const after = await prisma.paymentAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      expect(after.status).toBe('FAILED');
      expect(after.failureCode).toBe('PROVIDER_REPORTED_FAILURE');
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
      expect(await notifications(studentUserId, 'payment.failed')).toBe(before + 1);
      expect(
        (await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
      ).toBe('PENDING'); // balance untouched
    });

    it('unknown tracker: 200, recorded in the GatewayEvent ledger, nothing else', async () => {
      const res = await postWebhook(successEvent('track_unknown_' + suffix, '50', `evt_${suffix}_unm`));
      expect(res.status).toBe(200);
      const row = await prisma.gatewayEvent.findUniqueOrThrow({
        where: {
          provider_eventId: { provider: 'SAFEPAY', eventId: `evt_${suffix}_unm` },
        },
      });
      expect(row.outcome).toBe('UNMATCHED_SUCCEEDED');
      expect(row.attemptId).toBeNull();
    });

    it('SMTP failure never rolls back settlement', async () => {
      mailShouldFail = true;
      const { invoice, attempt } = await initiated('450');
      const res = await postWebhook(successEvent(attempt.providerRef!, '450'));
      mailShouldFail = false;
      expect(res.status).toBe(200);
      expect(
        (await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
          .status,
      ).toBe('SUCCEEDED');
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
      expect(
        (await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
      ).toBe('PAID');
    });
  });

  describe('verify-on-return', () => {
    it('ownership matrix: anon 401, other student 404, guardian 403, garbage 404', async () => {
      const { attempt } = await initiated('200');
      expect(
        (await http.post(`/api/v1/payments/attempts/${attempt.id}/verify`)).status,
      ).toBe(401);
      expect(
        (
          await http
            .post(`/api/v1/payments/attempts/${attempt.id}/verify`)
            .set(auth(otherStudentToken))
        ).status,
      ).toBe(404);
      expect(
        (
          await http
            .post(`/api/v1/payments/attempts/${attempt.id}/verify`)
            .set(auth(guardianToken))
        ).status,
      ).toBe(403);
      expect(
        (
          await http
            .post('/api/v1/payments/attempts/garbage/verify')
            .set(auth(studentToken))
        ).status,
      ).toBe(404);
    });

    it('forged browser success settles nothing: provider says PENDING → attempt stays PENDING', async () => {
      const { invoice, attempt } = await initiated('550');
      verifyResult = { state: 'PENDING', amount: '0.00', currency: 'PKR' };
      const res = await http
        .post(`/api/v1/payments/attempts/${attempt.id}/verify`)
        .set(auth(studentToken))
        .send({ success: true, amount: 550 }); // ignored noise
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('PENDING');
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
    });

    it('provider verify PAID settles through the same core (browser claimed failure — irrelevant)', async () => {
      const { invoice, attempt } = await initiated('1250');
      verifyResult = { state: 'PAID', amount: '1250.00', currency: 'PKR' };
      const res = await http
        .post(`/api/v1/payments/attempts/${attempt.id}/verify`)
        .set(auth(studentToken));
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('SUCCEEDED');
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
      expect(
        (await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
      ).toBe('PAID');
      // Second verify: idempotent, no double settlement/notification.
      const again = await http
        .post(`/api/v1/payments/attempts/${attempt.id}/verify`)
        .set(auth(studentToken));
      expect(again.body.data.status).toBe('SUCCEEDED');
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
      verifyResult = { state: 'PENDING', amount: '0.00', currency: 'PKR' };
    });

    it('provider verify amount mismatch fails the attempt without settling', async () => {
      const { invoice, attempt } = await initiated('999');
      verifyResult = { state: 'PAID', amount: '5.00', currency: 'PKR' };
      const res = await http
        .post(`/api/v1/payments/attempts/${attempt.id}/verify`)
        .set(auth(studentToken));
      verifyResult = { state: 'PENDING', amount: '0.00', currency: 'PKR' };
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('FAILED');
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
    });

    it('provider verify FAILED fails the attempt (idempotently)', async () => {
      const { invoice, attempt } = await initiated('333');
      verifyResult = { state: 'FAILED', amount: '0.00', currency: 'PKR' };
      const res = await http
        .post(`/api/v1/payments/attempts/${attempt.id}/verify`)
        .set(auth(studentToken));
      verifyResult = { state: 'PENDING', amount: '0.00', currency: 'PKR' };
      expect(res.body.data.status).toBe('FAILED');
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
    });
  });

  describe('adapter signature unit vector', () => {
    it('accepts the documented HMAC-SHA512 hex and rejects near-misses', () => {
      const raw = Buffer.from('{"a":1}');
      const good = createHmac('sha512', WEBHOOK_SECRET).update(raw).digest('hex');
      expect(realParser.verifyWebhookSignature(raw, good)).toBe(true);
      expect(realParser.verifyWebhookSignature(raw, good.toUpperCase())).toBe(true);
      expect(realParser.verifyWebhookSignature(raw, good.slice(0, -2) + '00')).toBe(false);
      expect(realParser.verifyWebhookSignature(raw, undefined)).toBe(false);
      expect(realParser.verifyWebhookSignature(raw, 'not-hex')).toBe(false);
    });
  });
});
