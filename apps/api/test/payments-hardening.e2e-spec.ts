import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { FeesService } from '../src/fees/fees.service';
import { PaymentsService } from '../src/payments/payments.service';
import {
  PAYMENT_GATEWAY,
  type PaymentGatewayAdapter,
} from '../src/payments/gateway.adapter';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M14-W6 — final hardening: TRUE concurrency between the money-moving
 * paths. Everything here exercises the invoice row lock + attempt CAS
 * under genuine parallelism (Promise.all), which the earlier sequential
 * suites could not.
 */
describe('M14-W6 — settlement concurrency hardening', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fees: FeesService;
  let payments: PaymentsService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let studentProfileId: string;
  let studentUserId: string;
  let adminUser: { id: string; collegeId: string; email: string; role: string };
  let structureId: string;
  const madeInvoiceIds: string[] = [];

  const fakeGateway: PaymentGatewayAdapter = {
    provider: 'SAFEPAY',
    async createCheckoutSession() {
      throw new Error('not used in W6 spec');
    },
    async verifyPayment() {
      return { state: 'PENDING' as const, amount: '0.00', currency: 'PKR' };
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

  function asAuthUser(user: { id: string; collegeId: string; email: string; role: string }) {
    return {
      id: user.id,
      collegeId: user.collegeId,
      email: user.email,
      role: user.role as 'ADMIN',
      status: 'ACTIVE' as const,
      verificationStatus: 'LEGACY' as const,
      firstName: 'x',
      lastName: 'x',
      avatarUrl: null,
      mustChangePassword: false,
    };
  }

  let invoiceSeq = 0;
  async function makeInvoice(amount: string) {
    invoiceSeq += 1;
    const invoice = await prisma.invoice.create({
      data: {
        collegeId,
        studentId: studentProfileId,
        structureId,
        invoiceNo: `W6-${suffix}-${invoiceSeq}`,
        amount,
        dueDate: new Date('2027-01-31'),
        status: 'PENDING',
      },
    });
    madeInvoiceIds.push(invoice.id);
    return invoice;
  }

  async function makePendingAttempt(invoiceId: string, amount: string, ref: string) {
    return prisma.paymentAttempt.create({
      data: {
        collegeId,
        invoiceId,
        initiatedById: studentUserId,
        amount,
        provider: 'SAFEPAY',
        providerRef: ref,
        status: 'PENDING',
      },
    });
  }

  beforeAll(async () => {
    app = await createTestApp([{ token: PAYMENT_GATEWAY, value: fakeGateway }]);
    prisma = app.get(PrismaService);
    fees = app.get(FeesService);
    payments = app.get(PaymentsService);
    http = request(app.getHttpServer());
    app.get(LoginRateLimiterService).reset();

    const student = await prisma.user.findFirstOrThrow({
      where: { email: 'student@campusos.dev' },
      include: { studentProfile: true },
    });
    studentUserId = student.id;
    studentProfileId = student.studentProfile!.id;
    collegeId = student.collegeId;
    adminUser = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    structureId = (
      await prisma.feeStructure.findFirstOrThrow({ where: { collegeId } })
    ).id;
  });

  afterAll(async () => {
    await prisma.gatewayEvent.deleteMany({});
    await prisma.paymentAttempt.deleteMany({
      where: { invoiceId: { in: madeInvoiceIds } },
    });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: madeInvoiceIds } } });
    await prisma.notification.deleteMany({
      where: { type: { in: ['payment.succeeded', 'payment.failed'] } },
    });
    await prisma.invoice.deleteMany({ where: { id: { in: madeInvoiceIds } } });
    await app.close();
  });

  it('CONCURRENT manual recording + gateway settlement never double-counts and never drops money', async () => {
    const invoice = await makeInvoice('1000');
    const attempt = await makePendingAttempt(invoice.id, '1000', `w6-race-a-${suffix}`);

    // Both money paths fire at the same instant against the same balance.
    const [manual, gateway] = await Promise.allSettled([
      fees.recordPayment(asAuthUser(adminUser), invoice.id, {
        amount: 1000,
        method: 'CASH',
      }),
      payments.settleAttempt(attempt.id, {
        provider: 'SAFEPAY',
        providerRef: `w6-race-a-${suffix}`,
        amount: '1000',
        currency: 'PKR',
      }),
    ]);

    // The gateway settlement can NEVER be rejected — the money moved.
    expect(gateway.status).toBe('fulfilled');
    const settled = await prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    expect(settled.status).toBe('SUCCEEDED');

    const rows = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    if (manual.status === 'fulfilled') {
      // Row lock serialized them: whichever ran second saw the consumed
      // balance — the manual path can only have succeeded if it went
      // FIRST (balance was still open), and the settlement is then
      // flagged overpaid. Money is never double-counted into the status.
      expect(rows).toHaveLength(2);
      expect(settled.overpaid).toBe(true);
    } else {
      // Manual lost the race and was correctly refused (OVERPAYMENT).
      expect((manual as PromiseRejectedResult).reason).toMatchObject({
        response: { code: 'OVERPAYMENT' },
      });
      expect(rows).toHaveLength(1);
      expect(settled.overpaid).toBe(false);
    }
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(after.status).toBe('PAID'); // capped, regardless of ordering
    expect(rows.every((p) => Number(p.amount) > 0)).toBe(true);
  });

  it('CONCURRENT settlement of two distinct attempts against one balance: both recorded, exactly one flagged overpaid', async () => {
    const invoice = await makeInvoice('500');
    const a = await makePendingAttempt(invoice.id, '500', `w6-race-b1-${suffix}`);
    const b = await makePendingAttempt(invoice.id, '500', `w6-race-b2-${suffix}`);

    const [ra, rb] = await Promise.all([
      payments.settleAttempt(a.id, {
        provider: 'SAFEPAY',
        providerRef: `w6-race-b1-${suffix}`,
        amount: '500',
        currency: 'PKR',
      }),
      payments.settleAttempt(b.id, {
        provider: 'SAFEPAY',
        providerRef: `w6-race-b2-${suffix}`,
        amount: '500',
        currency: 'PKR',
      }),
    ]);
    expect(ra.status).toBe('SUCCEEDED');
    expect(rb.status).toBe('SUCCEEDED');
    // Confirmed money is never dropped: two Payment rows exist…
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(2);
    // …the invoice is capped at PAID, and exactly one attempt carries the
    // overpaid flag for reconciliation.
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(after.status).toBe('PAID');
    const flags = [ra.overpaid, rb.overpaid].filter(Boolean);
    expect(flags).toHaveLength(1);
  });

  it('CONCURRENT settle + fail of the same attempt resolves to exactly one terminal outcome', async () => {
    const invoice = await makeInvoice('300');
    const attempt = await makePendingAttempt(invoice.id, '300', `w6-race-c-${suffix}`);
    const [settleResult] = await Promise.all([
      payments.settleAttempt(attempt.id, {
        provider: 'SAFEPAY',
        providerRef: `w6-race-c-${suffix}`,
        amount: '300',
        currency: 'PKR',
      }),
      payments.failAttempt(attempt.id, 'PROVIDER_REPORTED_FAILURE'),
    ]);
    const final = await prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    const paymentsCount = await prisma.payment.count({
      where: { invoiceId: invoice.id },
    });
    // CAS guarantees a single winner: either the settle claimed PENDING
    // (SUCCEEDED + 1 payment) or the failure did (FAILED + 0 payments) —
    // never a settled-but-failed hybrid, never money without SUCCEEDED.
    if (final.status === 'SUCCEEDED') {
      expect(paymentsCount).toBe(1);
      expect(final.paymentId).toBeTruthy();
    } else {
      expect(final.status).toBe('FAILED');
      expect(paymentsCount).toBe(0);
      expect(settleResult.justSettled ?? false).toBe(false);
    }
  });
});
