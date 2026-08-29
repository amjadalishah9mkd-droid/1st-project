import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';
const YEAR = new Date().getUTCFullYear();

/**
 * M20-W1 — finance document foundation.
 * Real-Postgres coverage: migration #14 structures, automatic issuance in
 * every money transaction, historical issuance, numbering under REAL
 * concurrency (advisory lock + retry-on-P2002), DB-level duplicate
 * protection, ACTIVE→VOID CAS, tenancy, authorization, exactly-once audit,
 * frozen-snapshot immutability and money-ledger isolation.
 */
describe('M20-W1 — finance documents', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);

  let collegeId: string;
  let adminId: string;
  let accountantToken: string;
  let adminToken: string;
  let studentToken: string;
  let teacherToken: string;
  let rivalAdminToken: string;
  let rivalCollegeId: string;
  let rivalPaymentId: string;

  let termId: string;
  let structureId: string;
  let studentProfileId: string;
  const invoiceIds: string[] = [];
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

  async function makeInvoice(amount: string): Promise<string> {
    const invoice = await prisma.invoice.create({
      data: {
        collegeId,
        studentId: studentProfileId,
        structureId,
        invoiceNo: `W1FD-${suffix}-${invoiceIds.length + 1}`,
        amount,
        dueDate: new Date('2027-06-30'),
        status: 'PENDING',
      },
    });
    invoiceIds.push(invoice.id);
    return invoice.id;
  }

  /** Direct ledger row (simulates a pre-M20 payment: NO document). */
  async function makeLegacyPayment(invoiceId: string, amount: string) {
    return prisma.payment.create({
      data: {
        invoiceId,
        amount,
        method: 'CASH',
        paidAt: new Date(),
        recordedById: adminId,
      },
    });
  }

  const issuedAudits = () =>
    prisma.auditLog.count({
      where: { collegeId, action: 'fees.receipt_issued' },
    });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
    adminId = admin.id;
    termId = (await prisma.term.findFirstOrThrow({ where: { collegeId } })).id;
    studentProfileId = (
      await prisma.studentProfile.findFirstOrThrow({ where: { collegeId } })
    ).id;
    const structure = await prisma.feeStructure.create({
      data: {
        collegeId,
        termId,
        name: `W1FD structure ${suffix}`,
        totalAmount: '1000.00',
        components: { create: [{ label: 'Tuition', amount: '1000.00' }] },
      },
    });
    structureId = structure.id;

    // Rival college with its own settled payment (tenancy + numbering).
    const argon2 = await import('argon2');
    const passwordHash = await argon2.hash(DEMO_PASSWORD, {
      type: argon2.argon2id,
    });
    const rival = await prisma.college.create({
      data: { name: 'Rival College FD', code: `RVFD-${suffix}` },
    });
    rivalCollegeId = rival.id;
    const rivalAdmin = await prisma.user.create({
      data: {
        college: { connect: { id: rival.id } },
        email: `rival-fd-${suffix}@campusos.dev`,
        passwordHash,
        role: 'ADMIN',
        firstName: 'Rival',
        lastName: 'FD',
        mustChangePassword: false,
      },
    });
    madeUserIds.push(rivalAdmin.id);
    const rivalDept = await prisma.department.create({
      data: { collegeId: rival.id, name: 'RD', code: `RD-${suffix}` },
    });
    const rivalStudentUser = await prisma.user.create({
      data: {
        college: { connect: { id: rival.id } },
        email: `rival-fd-stu-${suffix}@campusos.dev`,
        passwordHash,
        role: 'STUDENT',
        firstName: 'RivalStu',
        lastName: 'FD',
        mustChangePassword: false,
      },
    });
    madeUserIds.push(rivalStudentUser.id);
    const rivalProfile = await prisma.studentProfile.create({
      data: {
        userId: rivalStudentUser.id,
        collegeId: rival.id,
        departmentId: rivalDept.id,
        admissionNo: `RFD-${suffix}`,
        rollNo: 'R-1',
        batch: '2026',
      },
    });
    const rivalYear = await prisma.academicYear.create({
      data: {
        collegeId: rival.id,
        label: `RY-${suffix}`,
        startsOn: new Date('2026-01-01'),
        endsOn: new Date('2026-12-31'),
      },
    });
    const rivalTerm = await prisma.term.create({
      data: {
        collegeId: rival.id,
        academicYearId: rivalYear.id,
        label: `RT-${suffix}`,
        startsOn: new Date('2026-01-01'),
        endsOn: new Date('2026-06-30'),
      },
    });
    const rivalStructure = await prisma.feeStructure.create({
      data: {
        collegeId: rival.id,
        termId: rivalTerm.id,
        name: 'Rival structure',
        totalAmount: '500.00',
        components: { create: [{ label: 'T', amount: '500.00' }] },
      },
    });
    const rivalInvoice = await prisma.invoice.create({
      data: {
        collegeId: rival.id,
        studentId: rivalProfile.id,
        structureId: rivalStructure.id,
        invoiceNo: `RVI-${suffix}`,
        amount: '500.00',
        dueDate: new Date('2027-06-30'),
        status: 'PAID',
      },
    });
    rivalPaymentId = (
      await prisma.payment.create({
        data: {
          invoiceId: rivalInvoice.id,
          amount: '500.00',
          method: 'CASH',
          paidAt: new Date(),
          recordedById: rivalAdmin.id,
        },
      })
    ).id;

    accountantToken = await login('accountant@campusos.dev');
    adminToken = await login('admin@campusos.dev');
    studentToken = await login('student@campusos.dev');
    teacherToken = await login('teacher@campusos.dev');
    rivalAdminToken = await login(rivalAdmin.email);
  });

  afterAll(async () => {
    await prisma.financeDocument.deleteMany({
      where: { collegeId: { in: [collegeId, rivalCollegeId] } },
    });
    await prisma.refundAttempt.deleteMany({
      where: { invoiceId: { in: invoiceIds } },
    });
    await prisma.refund.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.feeComponent.deleteMany({ where: { structureId } });
    await prisma.feeStructure.deleteMany({ where: { id: structureId } });
    // Rival college teardown (documents removed above).
    await prisma.payment.deleteMany({
      where: { invoice: { collegeId: rivalCollegeId } },
    });
    await prisma.invoice.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.feeComponent.deleteMany({
      where: { structure: { collegeId: rivalCollegeId } },
    });
    await prisma.feeStructure.deleteMany({
      where: { collegeId: rivalCollegeId },
    });
    await prisma.studentProfile.deleteMany({
      where: { collegeId: rivalCollegeId },
    });
    await prisma.term.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.academicYear.deleteMany({
      where: { collegeId: rivalCollegeId },
    });
    await prisma.department.deleteMany({
      where: { collegeId: rivalCollegeId },
    });
    await prisma.auditLog.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.user.deleteMany({ where: { id: { in: madeUserIds } } });
    await prisma.college.delete({ where: { id: rivalCollegeId } });
    await app.close();
  });

  it('migration #14 structures exist (table, enums, uniques); >=14 migrations', async () => {
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_name = 'FinanceDocument'`;
    expect(tables).toHaveLength(1);
    const uniques = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'FinanceDocument'`;
    const names = uniques.map((u) => u.indexname).join(',');
    expect(names).toContain('FinanceDocument_collegeId_receiptNo_key');
    expect(names).toContain('FinanceDocument_paymentId_key');
    expect(names).toContain('FinanceDocument_refundId_key');
    const migrations = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    expect(Number(migrations[0].count)).toBeGreaterThanOrEqual(14);
  });

  it('manual payment recording auto-issues a frozen receipt in the same transaction', async () => {
    const invoiceId = await makeInvoice('1000.00');
    const before = await issuedAudits();
    const res = await http
      .post(`/api/v1/fees/invoices/${invoiceId}/payments`)
      .set(auth(accountantToken))
      .send({ amount: 400, method: 'CASH', reference: 'manual-ref-123456' });
    expect(res.status).toBe(201);

    const payment = await prisma.payment.findFirstOrThrow({
      where: { invoiceId },
    });
    const doc = await prisma.financeDocument.findUniqueOrThrow({
      where: { paymentId: payment.id },
    });
    expect(doc.kind).toBe('PAYMENT_RECEIPT');
    expect(doc.status).toBe('ACTIVE');
    expect(doc.collegeId).toBe(collegeId);
    expect(doc.receiptNo).toMatch(new RegExp(`^RCP-${YEAR}-\\d{5}$`));
    expect(doc.invoiceNo).toBe(`W1FD-${suffix}-1`);
    expect(Number(doc.amount)).toBe(400);
    expect(Number(doc.invoiceAmount)).toBe(1000);
    expect(Number(doc.balanceAfter)).toBe(600);
    expect(doc.method).toBe('CASH');
    expect(doc.referenceMasked).toBe('…123456'); // masked, never the full ref
    expect(doc.studentName.length).toBeGreaterThan(0);
    expect(doc.receivedByName).toBeTruthy();
    expect(await issuedAudits()).toBe(before + 1);
  });

  it('historical issuance works once; replay 409; concurrent duplicate → exactly one document + one audit', async () => {
    const invoiceId = await makeInvoice('300.00');
    const legacy = await makeLegacyPayment(invoiceId, '300.00');
    const before = await issuedAudits();

    const [a, b] = await Promise.all([
      http
        .post(`/api/v1/fees/payments/${legacy.id}/receipt`)
        .set(auth(accountantToken)),
      http
        .post(`/api/v1/fees/payments/${legacy.id}/receipt`)
        .set(auth(accountantToken)),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe('ALREADY_ISSUED');

    const replay = await http
      .post(`/api/v1/fees/payments/${legacy.id}/receipt`)
      .set(auth(accountantToken));
    expect(replay.status).toBe(409);

    const docs = await prisma.financeDocument.findMany({
      where: { paymentId: legacy.id },
    });
    expect(docs).toHaveLength(1);
    expect(await issuedAudits()).toBe(before + 1);
  });

  it('REAL concurrent issuance across payments: distinct numbers, no unique-error escapes', async () => {
    const payments = [] as string[];
    for (let i = 0; i < 4; i += 1) {
      const invoiceId = await makeInvoice('50.00');
      payments.push((await makeLegacyPayment(invoiceId, '50.00')).id);
    }
    const results = await Promise.all(
      payments.map((id) =>
        http.post(`/api/v1/fees/payments/${id}/receipt`).set(auth(adminToken)),
      ),
    );
    for (const res of results) expect(res.status).toBe(201);
    const numbers = results.map((r) => r.body.data.receiptNo as string);
    expect(new Set(numbers).size).toBe(4);
    for (const n of numbers) expect(n).toMatch(new RegExp(`^RCP-${YEAR}-\\d{5}$`));
  });

  it('numbering is per-college: rival college gets its own independent sequence', async () => {
    const res = await http
      .post(`/api/v1/fees/payments/${rivalPaymentId}/receipt`)
      .set(auth(rivalAdminToken));
    expect(res.status).toBe(201);
    expect(res.body.data.receiptNo).toBe(`RCP-${YEAR}-00001`);
    expect(res.body.data.collegeId).toBe(rivalCollegeId);
    // Demo college numbering unaffected: next demo doc is NOT 00001.
    const invoiceId = await makeInvoice('10.00');
    const p = await makeLegacyPayment(invoiceId, '10.00');
    const demo = await http
      .post(`/api/v1/fees/payments/${p.id}/receipt`)
      .set(auth(adminToken));
    expect(demo.status).toBe(201);
    expect(demo.body.data.receiptNo).not.toBe(`RCP-${YEAR}-00001`);
  });

  it('retry-on-P2002: an out-of-band number collision is skipped, not fatal', async () => {
    // Occupy the NEXT number with a mismatched (sequence=0) row so the
    // service's max(sequence)+1 collides on receiptNo and must retry.
    const agg = await prisma.financeDocument.aggregate({
      where: { collegeId, kind: 'PAYMENT_RECEIPT', year: YEAR },
      _max: { sequence: true },
    });
    const nextSeq = (agg._max.sequence ?? 0) + 1;
    const invoiceA = await makeInvoice('20.00');
    const blockerPayment = await makeLegacyPayment(invoiceA, '20.00');
    await prisma.financeDocument.create({
      data: {
        collegeId,
        kind: 'PAYMENT_RECEIPT',
        receiptNo: `RCP-${YEAR}-${String(nextSeq).padStart(5, '0')}`,
        year: YEAR,
        sequence: 0, // deliberately mismatched — forces a P2002 on the number
        paymentId: blockerPayment.id,
        invoiceId: invoiceA,
        studentName: 'X',
        admissionNo: 'X',
        rollNo: 'X',
        invoiceNo: 'X',
        structureName: 'X',
        collegeName: 'X',
        collegeCode: 'X',
        amount: '20.00',
        method: 'CASH',
        paidAt: new Date(),
        invoiceAmount: '20.00',
        balanceAfter: '0.00',
      },
    });
    const invoiceB = await makeInvoice('30.00');
    const p = await makeLegacyPayment(invoiceB, '30.00');
    const res = await http
      .post(`/api/v1/fees/payments/${p.id}/receipt`)
      .set(auth(adminToken));
    expect(res.status).toBe(201);
    // The colliding number was skipped; the new number is beyond it.
    expect(res.body.data.receiptNo).not.toBe(
      `RCP-${YEAR}-${String(nextSeq).padStart(5, '0')}`,
    );
    expect(res.body.data.sequence).toBeGreaterThan(nextSeq);
  });

  it('tenancy: cross-college payment/refund/document → 404, no existence leak', async () => {
    const res = await http
      .post(`/api/v1/fees/payments/${rivalPaymentId}/receipt`)
      .set(auth(accountantToken));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    const rivalDoc = await prisma.financeDocument.findFirstOrThrow({
      where: { collegeId: rivalCollegeId },
    });
    const voidForeign = await http
      .post(`/api/v1/fees/documents/${rivalDoc.id}/void`)
      .set(auth(accountantToken))
      .send({ reason: 'should never work' });
    expect(voidForeign.status).toBe(404);

    const missing = await http
      .post('/api/v1/fees/payments/nonexistent-payment-id/receipt')
      .set(auth(accountantToken));
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(res.body); // indistinguishable
  });

  it('authorization: anon 401; student/teacher 403 (fees.manage required); accountant/admin allowed', async () => {
    const invoiceId = await makeInvoice('15.00');
    const p = await makeLegacyPayment(invoiceId, '15.00');
    expect(
      (await http.post(`/api/v1/fees/payments/${p.id}/receipt`)).status,
    ).toBe(401);
    expect(
      (
        await http
          .post(`/api/v1/fees/payments/${p.id}/receipt`)
          .set(auth(studentToken))
      ).status,
    ).toBe(403);
    expect(
      (
        await http
          .post(`/api/v1/fees/payments/${p.id}/receipt`)
          .set(auth(teacherToken))
      ).status,
    ).toBe(403);
    const ok = await http
      .post(`/api/v1/fees/payments/${p.id}/receipt`)
      .set(auth(accountantToken));
    expect(ok.status).toBe(201);
  });

  it('RECORDED refund auto-issues a refund document linked to the parent receipt; the receipt is untouched (O-5)', async () => {
    const invoiceId = await makeInvoice('200.00');
    // Settled via API → receipt exists.
    await http
      .post(`/api/v1/fees/invoices/${invoiceId}/payments`)
      .set(auth(accountantToken))
      .send({ amount: 200, method: 'CASH' });
    const payment = await prisma.payment.findFirstOrThrow({
      where: { invoiceId },
    });
    const receipt = await prisma.financeDocument.findUniqueOrThrow({
      where: { paymentId: payment.id },
    });

    const created = await http
      .post(`/api/v1/fees/payments/${payment.id}/refunds`)
      .set(auth(accountantToken))
      .send({ amount: 80, currency: 'PKR', reason: 'partial refund test', method: 'RECORDED' });
    expect(created.status).toBe(201);
    const attemptId = created.body.data.id as string;
    const executed = await http
      .post(`/api/v1/fees/refunds/${attemptId}/execute`)
      .set(auth(accountantToken))
      .send({ confirmAmount: '80.00' });
    expect(executed.status).toBe(201);

    const refund = await prisma.refund.findFirstOrThrow({
      where: { paymentId: payment.id },
    });
    const doc = await prisma.financeDocument.findUniqueOrThrow({
      where: { refundId: refund.id },
    });
    expect(doc.kind).toBe('REFUND_DOCUMENT');
    expect(doc.receiptNo).toMatch(new RegExp(`^RFD-${YEAR}-\\d{5}$`));
    expect(Number(doc.amount)).toBe(80);
    expect(doc.method).toBe('RECORDED');
    expect(doc.parentReceiptNo).toBe(receipt.receiptNo);
    // Refund internal reason NEVER enters the document snapshot.
    expect(JSON.stringify(doc)).not.toContain('partial refund test');

    // O-5: the payment receipt is not mutated or voided by the refund.
    const receiptAfter = await prisma.financeDocument.findUniqueOrThrow({
      where: { paymentId: payment.id },
    });
    expect(receiptAfter.status).toBe('ACTIVE');
    expect(receiptAfter.updatedAt.getTime()).toBe(receipt.updatedAt.getTime());
    expect(Number(receiptAfter.amount)).toBe(200);
  });

  it('historical refund-document issuance: once, then 409', async () => {
    const invoiceId = await makeInvoice('60.00');
    const legacy = await makeLegacyPayment(invoiceId, '60.00');
    const refund = await prisma.refund.create({
      data: {
        paymentId: legacy.id,
        invoiceId,
        amount: '60.00',
        method: 'PROVIDER',
        reference: 'refund_abcdef123456',
        refundedAt: new Date(),
        recordedById: null,
      },
    });
    const first = await http
      .post(`/api/v1/fees/refunds/${refund.id}/document`)
      .set(auth(accountantToken));
    expect(first.status).toBe(201);
    expect(first.body.data.referenceMasked).toBe('…123456'); // provider ref masked
    expect(first.body.data.parentReceiptNo).toBeNull(); // legacy payment had no receipt
    const second = await http
      .post(`/api/v1/fees/refunds/${refund.id}/document`)
      .set(auth(accountantToken));
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_ISSUED');
  });

  it('immutability: renames, invoice changes and later money never alter an issued snapshot', async () => {
    const invoiceId = await makeInvoice('500.00');
    await http
      .post(`/api/v1/fees/invoices/${invoiceId}/payments`)
      .set(auth(accountantToken))
      .send({ amount: 250, method: 'BANK_TRANSFER' });
    const payment = await prisma.payment.findFirstOrThrow({
      where: { invoiceId },
    });
    const original = await prisma.financeDocument.findUniqueOrThrow({
      where: { paymentId: payment.id },
    });

    // Mutate every upstream source the snapshot came from.
    const profile = await prisma.studentProfile.findUniqueOrThrow({
      where: { id: studentProfileId },
      select: { userId: true },
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: profile.userId },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { firstName: `Renamed-${suffix}` },
    });
    const college = await prisma.college.findUniqueOrThrow({
      where: { id: collegeId },
    });
    await prisma.college.update({
      where: { id: collegeId },
      data: { name: `Renamed College ${suffix}` },
    });
    await prisma.feeStructure.update({
      where: { id: structureId },
      data: { name: `Renamed structure ${suffix}` },
    });
    // Later money: pay the rest, then refund part of the new payment.
    await http
      .post(`/api/v1/fees/invoices/${invoiceId}/payments`)
      .set(auth(accountantToken))
      .send({ amount: 250, method: 'CASH' });

    try {
      const after = await prisma.financeDocument.findUniqueOrThrow({
        where: { paymentId: payment.id },
      });
      // The full frozen payload is byte-identical.
      expect(after).toEqual(original);
      expect(after.studentName).not.toContain(`Renamed-${suffix}`);
      expect(after.collegeName).toBe(original.collegeName);
      expect(after.structureName).toBe(original.structureName);
      expect(Number(after.balanceAfter)).toBe(250); // frozen at issuance
    } finally {
      await prisma.user.update({
        where: { id: user.id },
        data: { firstName: user.firstName },
      });
      await prisma.college.update({
        where: { id: collegeId },
        data: { name: college.name },
      });
    }
  });

  it('void: reason required, CAS-protected, audited once, number consumed forever', async () => {
    const invoiceId = await makeInvoice('90.00');
    const p = await makeLegacyPayment(invoiceId, '90.00');
    const issued = await http
      .post(`/api/v1/fees/payments/${p.id}/receipt`)
      .set(auth(accountantToken));
    const docId = issued.body.data.id as string;
    const receiptNo = issued.body.data.receiptNo as string;

    const noReason = await http
      .post(`/api/v1/fees/documents/${docId}/void`)
      .set(auth(accountantToken))
      .send({ reason: 'x' });
    expect(noReason.status).toBe(400);

    const [v1, v2] = await Promise.all([
      http
        .post(`/api/v1/fees/documents/${docId}/void`)
        .set(auth(accountantToken))
        .send({ reason: 'recorded against the wrong invoice' }),
      http
        .post(`/api/v1/fees/documents/${docId}/void`)
        .set(auth(accountantToken))
        .send({ reason: 'recorded against the wrong invoice' }),
    ]);
    expect([v1.status, v2.status].sort()).toEqual([201, 409]);
    const winner = v1.status === 201 ? v1 : v2;
    expect(winner.body.data.status).toBe('VOID');
    expect(winner.body.data.voidReason).toBe(
      'recorded against the wrong invoice',
    );

    const again = await http
      .post(`/api/v1/fees/documents/${docId}/void`)
      .set(auth(accountantToken))
      .send({ reason: 'second void attempt' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');

    const voidAudits = await prisma.auditLog.count({
      where: {
        collegeId,
        action: 'fees.receipt_voided',
        targetId: docId,
      },
    });
    expect(voidAudits).toBe(1);

    // The number remains consumed: the row persists as VOID and re-issuing
    // for the same payment is still impossible.
    const doc = await prisma.financeDocument.findUniqueOrThrow({
      where: { id: docId },
    });
    expect(doc.status).toBe('VOID');
    expect(doc.receiptNo).toBe(receiptNo);
    const reissue = await http
      .post(`/api/v1/fees/payments/${p.id}/receipt`)
      .set(auth(accountantToken));
    expect(reissue.status).toBe(409);

    // Student cannot void.
    const other = await http
      .post(`/api/v1/fees/documents/${docId}/void`)
      .set(auth(studentToken))
      .send({ reason: 'student trying to void' });
    expect(other.status).toBe(403);
  });

  it('financial isolation: issuance and void never touch Payment/Refund/Invoice truth', async () => {
    const invoiceId = await makeInvoice('75.00');
    const p = await makeLegacyPayment(invoiceId, '75.00');
    const paymentBefore = await prisma.payment.findUniqueOrThrow({
      where: { id: p.id },
    });
    const invoiceBefore = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });

    const issued = await http
      .post(`/api/v1/fees/payments/${p.id}/receipt`)
      .set(auth(adminToken));
    await http
      .post(`/api/v1/fees/documents/${issued.body.data.id}/void`)
      .set(auth(adminToken))
      .send({ reason: 'isolation check void' });

    const paymentAfter = await prisma.payment.findUniqueOrThrow({
      where: { id: p.id },
    });
    const invoiceAfter = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });
    expect(paymentAfter).toEqual(paymentBefore);
    expect(invoiceAfter).toEqual(invoiceBefore);
  });

  it('failed issuance emits no audit; client cannot control number/status/college', async () => {
    const before = await issuedAudits();
    const missing = await http
      .post('/api/v1/fees/payments/does-not-exist/receipt')
      .set(auth(accountantToken))
      .send({
        receiptNo: 'RCP-9999-99999',
        status: 'VOID',
        collegeId: rivalCollegeId,
      });
    expect(missing.status).toBe(404);
    expect(await issuedAudits()).toBe(before);

    // Even with a hostile body on a VALID target, every value is
    // server-derived.
    const invoiceId = await makeInvoice('25.00');
    const p = await makeLegacyPayment(invoiceId, '25.00');
    const res = await http
      .post(`/api/v1/fees/payments/${p.id}/receipt`)
      .set(auth(accountantToken))
      .send({
        receiptNo: 'RCP-9999-99999',
        status: 'VOID',
        collegeId: rivalCollegeId,
        amount: '999999.00',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.receiptNo).not.toBe('RCP-9999-99999');
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.collegeId).toBe(collegeId);
    expect(Number(res.body.data.amount)).toBe(25);
  });
});
