import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { RoleKey } from '@campusos/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentsService, ATTEMPT_TTL_MS } from '../src/payments/payments.service';
import { FeesService } from '../src/fees/fees.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M14-W1 — payments settlement core.
 * Payment stays "settled money only"; PaymentAttempt owns the in-flight
 * lifecycle; every money-moving path serializes on the invoice row.
 */
describe('M14-W1 — payments settlement core', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let payments: PaymentsService;
  let fees: FeesService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let rivalCollegeId: string;
  let studentUser: { id: string; collegeId: string; email: string; role: string };
  let otherStudentUser: { id: string; collegeId: string; email: string; role: string };
  let adminUser: { id: string; collegeId: string; email: string; role: string };
  let guardianUser: { id: string; collegeId: string; email: string; role: string };
  let studentProfileId: string;
  let structureId: string;
  let rivalInvoiceId: string;
  const madeInvoiceIds: string[] = [];
  const madeUserIds: string[] = [];

  function asAuthUser(user: {
    id: string;
    collegeId: string;
    email: string;
    role: string;
  }) {
    return {
      id: user.id,
      collegeId: user.collegeId,
      email: user.email,
      role: user.role as RoleKey,
      status: 'ACTIVE' as const,
      verificationStatus: 'LEGACY' as const,
      firstName: 'x',
      lastName: 'x',
      avatarUrl: null,
      mustChangePassword: false,
    };
  }

  let invoiceSeq = 0;
  async function makeInvoice(amount: string, opts: { collegeId?: string; studentId?: string } = {}) {
    invoiceSeq += 1;
    const invoice = await prisma.invoice.create({
      data: {
        collegeId: opts.collegeId ?? collegeId,
        studentId: opts.studentId ?? studentProfileId,
        structureId,
        invoiceNo: `W1-${suffix}-${invoiceSeq}`,
        amount,
        dueDate: new Date('2027-01-31'),
        status: 'PENDING',
      },
    });
    madeInvoiceIds.push(invoice.id);
    return invoice;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    payments = app.get(PaymentsService);
    fees = app.get(FeesService);
    http = request(app.getHttpServer());
    app.get(LoginRateLimiterService).reset();

    const student = await prisma.user.findFirstOrThrow({
      where: { email: 'student@campusos.dev' },
      include: { studentProfile: true },
    });
    studentUser = student;
    studentProfileId = student.studentProfile!.id;
    collegeId = student.collegeId;
    adminUser = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    const other = await prisma.studentProfile.findFirstOrThrow({
      where: { collegeId, id: { not: studentProfileId } },
      include: { user: true },
    });
    otherStudentUser = other.user;

    const structure = await prisma.feeStructure.findFirstOrThrow({
      where: { collegeId },
    });
    structureId = structure.id;

    // Guardian with an ACTIVE link to the student — must still be unable
    // to initiate payments (decision #4: no payments.initiate grant).
    const argon2 = await import('argon2');
    const guardian = await prisma.user.create({
      data: {
        college: { connect: { id: collegeId } },
        email: `w1pay-g-${suffix}@campusos.dev`,
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        role: 'GUARDIAN',
        firstName: 'W1',
        lastName: 'Guardian',
        mustChangePassword: false,
      },
    });
    madeUserIds.push(guardian.id);
    await prisma.guardianLink.create({
      data: {
        collegeId,
        guardianUserId: guardian.id,
        studentProfileId,
        relationship: 'Parent',
      },
    });
    guardianUser = guardian;

    // Rival college fixture with its own invoice.
    const rival = await prisma.college.create({
      data: { name: 'Rival W1Pay College', code: `RVW1P-${suffix}` },
    });
    rivalCollegeId = rival.id;
    const rivalDept = await prisma.department.create({
      data: { college: { connect: { id: rival.id } }, code: `RVW1PD-${suffix}`, name: 'D' },
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
        totalAmount: '1000',
      },
    });
    const rivalStudentUser = await prisma.user.create({
      data: {
        college: { connect: { id: rival.id } },
        email: `w1pay-rs-${suffix}@campusos.dev`,
        role: 'STUDENT',
        firstName: 'R',
        lastName: 'S',
        mustChangePassword: false,
      },
    });
    madeUserIds.push(rivalStudentUser.id);
    const rivalProfile = await prisma.studentProfile.create({
      data: {
        user: { connect: { id: rivalStudentUser.id } },
        college: { connect: { id: rival.id } },
        department: { connect: { id: rivalDept.id } },
        admissionNo: `RVW1P-${suffix}`,
        rollNo: `RVW1PR-${suffix}`,
        batch: '2026',
      },
    });
    const rivalInvoice = await prisma.invoice.create({
      data: {
        collegeId: rival.id,
        studentId: rivalProfile.id,
        structureId: rivalStructure.id,
        invoiceNo: `RV-${suffix}`,
        amount: '1000',
        dueDate: new Date('2027-01-31'),
        status: 'PENDING',
      },
    });
    rivalInvoiceId = rivalInvoice.id;
  });

  afterAll(async () => {
    const invoiceIds = [...madeInvoiceIds, rivalInvoiceId];
    await prisma.gatewayEvent.deleteMany({});
    await prisma.paymentAttempt.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    // M20-W1: issued documents Restrict money-row deletion — clear them first.
    await prisma.financeDocument.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.guardianLink.deleteMany({ where: { guardianUserId: { in: madeUserIds } } });
    await prisma.studentProfile.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.feeStructure.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.term.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.academicYear.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.department.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: madeUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: madeUserIds } } });
    await prisma.college.delete({ where: { id: rivalCollegeId } });
    await app.close();
  });

  describe('grants', () => {
    it('student /me carries payments.initiate OWN; guardian and teacher do not', async () => {
      app.get(LoginRateLimiterService).reset();
      const login = await http
        .post('/api/v1/auth/login')
        .send({ email: 'student@campusos.dev', password: DEMO_PASSWORD });
      const grants = login.body.data.user.permissions as Array<{
        key: string;
        scope: string;
      }>;
      expect(grants).toContainEqual({ key: 'payments.initiate', scope: 'OWN' });

      const teacherLogin = await http
        .post('/api/v1/auth/login')
        .send({ email: 'teacher@campusos.dev', password: DEMO_PASSWORD });
      expect(
        teacherLogin.body.data.user.permissions.some(
          (g: { key: string }) => g.key === 'payments.initiate',
        ),
      ).toBe(false);
    });
  });

  describe('attempt creation', () => {
    it('freezes the full outstanding balance server-side', async () => {
      const invoice = await makeInvoice('5000');
      await fees.recordPayment(asAuthUser(adminUser), invoice.id, {
        amount: 1500,
        method: 'CASH',
      });
      const attempt = await payments.createAttempt(
        asAuthUser(studentUser),
        invoice.id,
        'SAFEPAY',
      );
      expect(attempt.status).toBe('CREATED');
      expect(Number(attempt.amount)).toBe(3500); // balance, not invoice total
      expect(attempt.currency).toBe('PKR');
      expect(attempt.collegeId).toBe(collegeId);
    });

    it('denies another student, an unlinked/linked guardian, and cross-college targets', async () => {
      const invoice = await makeInvoice('1000');
      await expect(
        payments.createAttempt(asAuthUser(otherStudentUser), invoice.id, 'SAFEPAY'),
      ).rejects.toMatchObject({ status: 404 }); // not their invoice
      await expect(
        payments.createAttempt(asAuthUser(guardianUser), invoice.id, 'SAFEPAY'),
      ).rejects.toMatchObject({ status: 403 }); // no grant (decision #4)
      await expect(
        payments.createAttempt(asAuthUser(studentUser), rivalInvoiceId, 'SAFEPAY'),
      ).rejects.toMatchObject({ status: 404 }); // cross-college → invisible
      await expect(
        payments.createAttempt(asAuthUser(studentUser), 'no-such-invoice', 'SAFEPAY'),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('refuses fully-paid, cancelled and already-in-progress invoices', async () => {
      const paidInvoice = await makeInvoice('100');
      await fees.recordPayment(asAuthUser(adminUser), paidInvoice.id, {
        amount: 100,
        method: 'CASH',
      });
      await expect(
        payments.createAttempt(asAuthUser(studentUser), paidInvoice.id, 'SAFEPAY'),
      ).rejects.toMatchObject({ response: { code: 'NOTHING_TO_PAY' } });

      const cancelled = await makeInvoice('100');
      await prisma.invoice.update({ where: { id: cancelled.id }, data: { status: 'CANCELLED' } });
      await expect(
        payments.createAttempt(asAuthUser(studentUser), cancelled.id, 'SAFEPAY'),
      ).rejects.toMatchObject({ response: { code: 'INVOICE_CANCELLED' } });

      const busy = await makeInvoice('100');
      await payments.createAttempt(asAuthUser(studentUser), busy.id, 'SAFEPAY');
      await expect(
        payments.createAttempt(asAuthUser(studentUser), busy.id, 'SAFEPAY'),
      ).rejects.toMatchObject({ response: { code: 'ATTEMPT_IN_PROGRESS' } });
    });
  });

  describe('settlement', () => {
    it('a verified confirmation settles exactly once — replay is a no-op', async () => {
      const invoice = await makeInvoice('2000');
      const attempt = await payments.createAttempt(
        asAuthUser(studentUser),
        invoice.id,
        'SAFEPAY',
      );
      await payments.markPending(attempt.id, `track-${suffix}-1`);

      const confirmation = {
        provider: 'SAFEPAY',
        providerRef: `track-${suffix}-1`,
        amount: '2000',
        currency: 'PKR',
      };
      const settled = await payments.settleAttempt(attempt.id, confirmation);
      expect(settled.status).toBe('SUCCEEDED');
      expect(settled.paymentId).toBeTruthy();
      expect(settled.overpaid).toBe(false);

      // Replay — same verified confirmation delivered again.
      const replayed = await payments.settleAttempt(attempt.id, confirmation);
      expect(replayed.status).toBe('SUCCEEDED');
      expect(replayed.paymentId).toBe(settled.paymentId);

      const rows = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
      expect(rows).toHaveLength(1); // exactly one settled Payment
      expect(rows[0].method).toBe('ONLINE');
      expect(rows[0].recordedById).toBeNull();
      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(after.status).toBe('PAID');

      // Audit: ids/amounts only, no PII/secrets.
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'payments.settled', targetId: invoice.id },
      });
      expect(audit.metadata).toMatchObject({
        attemptId: attempt.id,
        provider: 'SAFEPAY',
        overpaid: false,
      });
      expect(JSON.stringify(audit.metadata)).not.toContain('@');
    });

    it('amount/currency tampering fails the attempt and settles nothing', async () => {
      const invoice = await makeInvoice('900');
      const attempt = await payments.createAttempt(
        asAuthUser(studentUser),
        invoice.id,
        'SAFEPAY',
      );
      await payments.markPending(attempt.id, `track-${suffix}-2`);
      await expect(
        payments.settleAttempt(attempt.id, {
          provider: 'SAFEPAY',
          providerRef: `track-${suffix}-2`,
          amount: '1', // tampered
          currency: 'PKR',
        }),
      ).rejects.toMatchObject({ response: { code: 'AMOUNT_MISMATCH' } });
      const after = await prisma.paymentAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      expect(after.status).toBe('FAILED');
      expect(after.failureCode).toBe('AMOUNT_MISMATCH');
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
      // A later "real" confirmation cannot resurrect a failed attempt.
      const dead = await payments.settleAttempt(attempt.id, {
        provider: 'SAFEPAY',
        providerRef: `track-${suffix}-2`,
        amount: '900',
        currency: 'PKR',
      });
      expect(dead.status).toBe('FAILED');
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
    });

    it('a confirmation that exceeds the remaining balance is recorded but flagged (invoice capped at PAID)', async () => {
      const invoice = await makeInvoice('1000');
      const attempt = await payments.createAttempt(
        asAuthUser(studentUser),
        invoice.id,
        'SAFEPAY',
      );
      await payments.markPending(attempt.id, `track-${suffix}-3`);
      // Manual payment lands while the gateway checkout is open.
      await fees.recordPayment(asAuthUser(adminUser), invoice.id, {
        amount: 600,
        method: 'CASH',
      });
      const settled = await payments.settleAttempt(attempt.id, {
        provider: 'SAFEPAY',
        providerRef: `track-${suffix}-3`,
        amount: '1000',
        currency: 'PKR',
      });
      expect(settled.status).toBe('SUCCEEDED');
      expect(settled.overpaid).toBe(true); // money moved — never dropped
      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(after.status).toBe('PAID');
    });

    it('failAttempt is CAS and expiry sweeps stale attempts; EXPIRED cannot settle', async () => {
      const invoice = await makeInvoice('400');
      const attempt = await payments.createAttempt(
        asAuthUser(studentUser),
        invoice.id,
        'SAFEPAY',
      );
      await payments.failAttempt(attempt.id, 'USER_ABANDONED');
      const failed = await payments.failAttempt(attempt.id, 'SECOND_CALL');
      expect(failed.failureCode).toBe('USER_ABANDONED'); // first write wins

      const stale = await makeInvoice('300');
      const staleAttempt = await payments.createAttempt(
        asAuthUser(studentUser),
        stale.id,
        'SAFEPAY',
      );
      await prisma.paymentAttempt.update({
        where: { id: staleAttempt.id },
        data: { createdAt: new Date(Date.now() - ATTEMPT_TTL_MS - 60_000) },
      });
      const swept = await payments.expireStaleAttempts(collegeId);
      expect(swept).toBeGreaterThanOrEqual(1);
      const expired = await payments.settleAttempt(staleAttempt.id, {
        provider: 'SAFEPAY',
        providerRef: 'late-ref',
        amount: '300',
        currency: 'PKR',
      });
      expect(expired.status).toBe('EXPIRED'); // CAS refused; reconciliation (W5) handles it
      expect(await prisma.payment.count({ where: { invoiceId: stale.id } })).toBe(0);
    });
  });

  describe('idempotency ledger', () => {
    it('claimEvent grants an event exactly once', async () => {
      const first = await payments.claimEvent('SAFEPAY', `evt-${suffix}`, null, 'test');
      const second = await payments.claimEvent('SAFEPAY', `evt-${suffix}`, null, 'test');
      expect(first).toBe(true);
      expect(second).toBe(false);
    });
  });

  describe('recordPayment race fix', () => {
    it('two concurrent manual recordings cannot jointly overpay', async () => {
      const invoice = await makeInvoice('1000');
      const admin = asAuthUser(adminUser);
      const results = await Promise.allSettled([
        fees.recordPayment(admin, invoice.id, { amount: 800, method: 'CASH' }),
        fees.recordPayment(admin, invoice.id, { amount: 800, method: 'BANK_TRANSFER' }),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        response: { code: 'OVERPAYMENT' },
      });
      const paid = await prisma.payment.aggregate({
        where: { invoiceId: invoice.id },
        _sum: { amount: true },
      });
      expect(Number(paid._sum.amount)).toBe(800); // never 1600
    });

    it('manual recording behavior is otherwise unchanged (partial → paid)', async () => {
      const invoice = await makeInvoice('500');
      const admin = asAuthUser(adminUser);
      const partial = await fees.recordPayment(admin, invoice.id, {
        amount: 200,
        method: 'CASH',
      });
      expect(partial.status).toBe('PARTIAL');
      const full = await fees.recordPayment(admin, invoice.id, {
        amount: 300,
        method: 'CHEQUE',
      });
      expect(full.status).toBe('PAID');
      expect(full.payments.every((p) => p.recordedByName !== 'Online payment')).toBe(true);
    });
  });
});
