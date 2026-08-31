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

const settle = () => new Promise((r) => setTimeout(r, 250));

/**
 * M20-W3 — receipt/refund-document links in success mail.
 * Events run through the real EventsService and the real fees listener;
 * the DI fake captures deliveries. The link is presentation only — the
 * document page re-authorizes through GET /fees/documents/:id.
 */
describe('M20-W3 — finance document mail links', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let events: EventsService;
  const fake = new CapturingMailTransport();
  const suffix = `w3fm-${Date.now().toString(36)}`;

  let collegeId: string;
  let studentUserId: string;
  let accountantToken: string;
  let structureId: string;
  const invoiceIds: string[] = [];
  const attemptIds: string[] = [];
  const startedAt = new Date();

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function makeInvoice(amount: string, studentId: string) {
    const invoice = await prisma.invoice.create({
      data: {
        collegeId,
        studentId,
        structureId,
        invoiceNo: `W3FM-${suffix}-${invoiceIds.length + 1}`,
        amount,
        dueDate: new Date('2027-06-30'),
        status: 'PENDING',
      },
    });
    invoiceIds.push(invoice.id);
    return invoice;
  }

  beforeAll(async () => {
    process.env.SMTP_URL = 'smtp://fake:fake@127.0.0.1:2525';
    process.env.MAIL_FROM = 'CampusOS <no-reply@test.campusos.dev>';
    process.env.APP_BASE_URL = 'https://campus.test.example';
    app = await createTestApp([{ token: MAIL_TRANSPORT, value: fake }]);
    prisma = app.get(PrismaService);
    events = app.get(EventsService);
    http = request(app.getHttpServer());

    const demo = await prisma.user.findFirstOrThrow({
      where: { email: 'student@campusos.dev' },
      include: { studentProfile: true },
    });
    collegeId = demo.collegeId;
    studentUserId = demo.id;
    const term = await prisma.term.findFirstOrThrow({ where: { collegeId } });
    structureId = (
      await prisma.feeStructure.create({
        data: {
          collegeId,
          termId: term.id,
          name: `W3FM structure ${suffix}`,
          totalAmount: '100.00',
          components: { create: [{ label: 'T', amount: '100.00' }] },
        },
      })
    ).id;
    accountantToken = await login('accountant@campusos.dev');

    void studentUserId;
  });

  afterAll(async () => {
    // This suite emits real payment/refund events for the DEMO student —
    // remove the Notification rows those events created so exactly-once
    // counting suites (payments-webhook) keep a clean baseline.
    await prisma.notification.deleteMany({
      where: {
        userId: studentUserId,
        type: { in: ['payment.succeeded', 'refund.succeeded'] },
        createdAt: { gte: startedAt },
      },
    });
    await prisma.financeDocument.deleteMany({
      where: { invoiceId: { in: invoiceIds } },
    });
    await prisma.refundAttempt.deleteMany({
      where: { invoiceId: { in: invoiceIds } },
    });
    await prisma.refund.deleteMany({
      where: { invoiceId: { in: invoiceIds } },
    });
    await prisma.paymentAttempt.deleteMany({
      where: { id: { in: attemptIds } },
    });
    await prisma.payment.deleteMany({
      where: { invoiceId: { in: invoiceIds } },
    });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.feeComponent.deleteMany({ where: { structureId } });
    await prisma.feeStructure.deleteMany({ where: { id: structureId } });
    delete process.env.SMTP_URL;
    delete process.env.MAIL_FROM;
    delete process.env.APP_BASE_URL;
    await app.close();
  });

  it('payment-success mail links the issued receipt document', async () => {
    const demo = await prisma.user.findFirstOrThrow({
      where: { email: 'student@campusos.dev' },
      include: { studentProfile: true },
    });
    const invoice = await makeInvoice('100.00', demo.studentProfile!.id);
    // Settle via the real API path — the receipt is issued in-transaction.
    const res = await http
      .post(`/api/v1/fees/invoices/${invoice.id}/payments`)
      .set(auth(accountantToken))
      .send({ amount: 100, method: 'CASH' });
    expect(res.status).toBe(201);
    const payment = await prisma.payment.findFirstOrThrow({
      where: { invoiceId: invoice.id },
    });
    const doc = await prisma.financeDocument.findUniqueOrThrow({
      where: { paymentId: payment.id },
    });
    // Simulate the ONLINE outcome event (webhook/verify emit this shape) —
    // the attempt row carries the settled paymentId, exactly like settleAttempt.
    const attempt = await prisma.paymentAttempt.create({
      data: {
        collegeId,
        invoiceId: invoice.id,
        initiatedById: demo.id,
        amount: '100.00',
        provider: 'SAFEPAY',
        providerRef: `w3fm-${suffix}-ok`,
        status: 'SUCCEEDED',
        paymentId: payment.id,
        confirmedAt: new Date(),
      },
    });
    attemptIds.push(attempt.id);

    fake.reset();
    events.emit({
      type: 'payment.succeeded',
      studentUserId: demo.id,
      invoiceId: invoice.id,
      attemptId: attempt.id,
      amount: '100.00',
      invoiceNo: invoice.invoiceNo,
    });
    await settle();

    expect(fake.sent).toHaveLength(1);
    const mail = fake.sent[0];
    expect(mail.subject).toBe('Payment received');
    const link = `https://campus.test.example/fees/documents/${doc.id}`;
    expect(mail.text).toContain('Your official receipt:');
    expect(mail.text).toContain(link);
    expect(mail.html).toContain(`<a href="${link}">`);
    // The email link is presentation only — the page re-authorizes; an
    // unauthenticated fetch of the underlying API is still rejected.
    const anon = await http.get(`/api/v1/fees/documents/${doc.id}`);
    expect(anon.status).toBe(401);
  });

  it('refund-success mail links the refund document and never leaks the internal reason', async () => {
    const demo = await prisma.user.findFirstOrThrow({
      where: { email: 'student@campusos.dev' },
      include: { studentProfile: true },
    });
    const invoice = await makeInvoice('80.00', demo.studentProfile!.id);
    await http
      .post(`/api/v1/fees/invoices/${invoice.id}/payments`)
      .set(auth(accountantToken))
      .send({ amount: 80, method: 'CASH' });
    const payment = await prisma.payment.findFirstOrThrow({
      where: { invoiceId: invoice.id },
    });
    const created = await http
      .post(`/api/v1/fees/payments/${payment.id}/refunds`)
      .set(auth(accountantToken))
      .send({
        amount: 30,
        currency: 'PKR',
        reason: 'w3 secret internal reason',
        method: 'RECORDED',
      });
    expect(created.status).toBe(201);
    fake.reset();
    const exec = await http
      .post(`/api/v1/fees/refunds/${created.body.data.id}/execute`)
      .set(auth(accountantToken))
      .send({ confirmAmount: '30.00' });
    expect(exec.status).toBe(201);
    await settle();

    const refund = await prisma.refund.findFirstOrThrow({
      where: { paymentId: payment.id },
    });
    const doc = await prisma.financeDocument.findUniqueOrThrow({
      where: { refundId: refund.id },
    });
    const mail = fake.sent.find((m) => m.subject === 'Refund completed');
    expect(mail).toBeDefined();
    const link = `https://campus.test.example/fees/documents/${doc.id}`;
    expect(mail!.text).toContain('Your refund document:');
    expect(mail!.text).toContain(link);
    expect(mail!.html).toContain(`<a href="${link}">`);
    expect(mail!.text).not.toContain('w3 secret internal reason');
    expect(mail!.html).not.toContain('w3 secret internal reason');
  });

  it('legacy money without a document sends the unchanged mail (no fabricated link)', async () => {
    const demo = await prisma.user.findFirstOrThrow({
      where: { email: 'student@campusos.dev' },
      include: { studentProfile: true },
    });
    const invoice = await makeInvoice('50.00', demo.studentProfile!.id);
    // Legacy: payment + settled attempt WITHOUT a FinanceDocument.
    const payment = await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amount: '50.00',
        method: 'ONLINE',
        paidAt: new Date(),
      },
    });
    const attempt = await prisma.paymentAttempt.create({
      data: {
        collegeId,
        invoiceId: invoice.id,
        initiatedById: demo.id,
        amount: '50.00',
        provider: 'SAFEPAY',
        providerRef: `w3fm-${suffix}-legacy`,
        status: 'SUCCEEDED',
        paymentId: payment.id,
        confirmedAt: new Date(),
      },
    });
    attemptIds.push(attempt.id);

    fake.reset();
    events.emit({
      type: 'payment.succeeded',
      studentUserId: demo.id,
      invoiceId: invoice.id,
      attemptId: attempt.id,
      amount: '50.00',
      invoiceNo: invoice.invoiceNo,
    });
    await settle();

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].text).not.toContain('Your official receipt:');
    expect(fake.sent[0].text).not.toContain('/fees/documents/');
  });
});
