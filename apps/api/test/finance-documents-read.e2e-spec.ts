import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M20-W2 — finance-document READ API hardening.
 * Real-Postgres coverage of the fees.read scope matrix (ALL/OWN/CHILD),
 * GuardianLink gating, cross-student and cross-college IDOR, ACTIVE/VOID
 * read semantics, data minimization, query tampering, snapshot-only reads
 * and read-side immutability.
 */
describe('M20-W2 — finance document reads', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = `w2fd-${Date.now().toString(36)}`;

  let collegeId: string;
  let adminToken: string;
  let accountantToken: string;
  let teacherToken: string;
  let studentToken: string; // demo student — owner of docA
  let otherStudentToken: string; // same college, different student
  let guardianToken: string; // linked to demo student via ACTIVE GuardianLink
  let rivalAdminToken: string;
  let rivalCollegeId: string;

  let demoProfileId: string;
  let otherProfileId: string;
  let structureId: string;
  const invoiceIds: string[] = [];
  const madeUserIds: string[] = [];
  let guardianLinkId: string;

  let docA: { id: string; receiptNo: string }; // demo student's receipt
  let docB: { id: string; receiptNo: string }; // other student's receipt
  let invoiceA: string;
  let paymentA: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function makeSettledDoc(studentProfileId: string, amount: string) {
    const invoice = await prisma.invoice.create({
      data: {
        collegeId,
        studentId: studentProfileId,
        structureId,
        invoiceNo: `W2FD-${suffix}-${invoiceIds.length + 1}`,
        amount,
        dueDate: new Date('2027-06-30'),
        status: 'PENDING',
      },
    });
    invoiceIds.push(invoice.id);
    const res = await http
      .post(`/api/v1/fees/invoices/${invoice.id}/payments`)
      .set(auth(accountantToken))
      .send({ amount: Number(amount), method: 'CASH' });
    expect(res.status).toBe(201);
    const payment = await prisma.payment.findFirstOrThrow({
      where: { invoiceId: invoice.id },
    });
    const doc = await prisma.financeDocument.findUniqueOrThrow({
      where: { paymentId: payment.id },
    });
    return { invoiceId: invoice.id, paymentId: payment.id, doc };
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const demo = await prisma.user.findFirstOrThrow({
      where: { email: 'student@campusos.dev' },
      include: { studentProfile: true },
    });
    collegeId = demo.collegeId;
    demoProfileId = demo.studentProfile!.id;
    const term = await prisma.term.findFirstOrThrow({ where: { collegeId } });
    structureId = (
      await prisma.feeStructure.create({
        data: {
          collegeId,
          termId: term.id,
          name: `W2FD structure ${suffix}`,
          totalAmount: '100.00',
          components: { create: [{ label: 'T', amount: '100.00' }] },
        },
      })
    ).id;

    const argon2 = await import('argon2');
    const passwordHash = await argon2.hash(DEMO_PASSWORD, {
      type: argon2.argon2id,
    });

    // Second student in the SAME college (cross-student IDOR).
    const dept = await prisma.department.findFirstOrThrow({
      where: { collegeId },
    });
    const otherUser = await prisma.user.create({
      data: {
        college: { connect: { id: collegeId } },
        email: `w2fd-other-${suffix}@campusos.dev`,
        passwordHash,
        role: 'STUDENT',
        firstName: 'Other',
        lastName: 'Student',
        mustChangePassword: false,
      },
    });
    madeUserIds.push(otherUser.id);
    otherProfileId = (
      await prisma.studentProfile.create({
        data: {
          userId: otherUser.id,
          collegeId,
          departmentId: dept.id,
          admissionNo: `W2FD-${suffix}`,
          rollNo: 'W2-1',
          batch: '2026',
        },
      })
    ).id;

    // Guardian with an ACTIVE link to the DEMO student only.
    const guardianUser = await prisma.user.create({
      data: {
        college: { connect: { id: collegeId } },
        email: `w2fd-guardian-${suffix}@campusos.dev`,
        passwordHash,
        role: 'GUARDIAN',
        firstName: 'Guard',
        lastName: 'W2',
        mustChangePassword: false,
      },
    });
    madeUserIds.push(guardianUser.id);
    guardianLinkId = (
      await prisma.guardianLink.create({
        data: {
          collegeId,
          guardianUserId: guardianUser.id,
          studentProfileId: demoProfileId,
          relationship: 'MOTHER',
          status: 'ACTIVE',
        },
      })
    ).id;

    // Rival college admin (cross-college IDOR).
    const rival = await prisma.college.create({
      data: { name: 'Rival College W2FD', code: `RVW2FD-${suffix}` },
    });
    rivalCollegeId = rival.id;
    const rivalAdmin = await prisma.user.create({
      data: {
        college: { connect: { id: rival.id } },
        email: `w2fd-rival-${suffix}@campusos.dev`,
        passwordHash,
        role: 'ADMIN',
        firstName: 'Rival',
        lastName: 'W2FD',
        mustChangePassword: false,
      },
    });
    madeUserIds.push(rivalAdmin.id);

    adminToken = await login('admin@campusos.dev');
    accountantToken = await login('accountant@campusos.dev');
    teacherToken = await login('teacher@campusos.dev');
    studentToken = await login('student@campusos.dev');
    otherStudentToken = await login(otherUser.email);
    guardianToken = await login(guardianUser.email);
    rivalAdminToken = await login(rivalAdmin.email);

    const a = await makeSettledDoc(demoProfileId, '100.00');
    invoiceA = a.invoiceId;
    paymentA = a.paymentId;
    docA = { id: a.doc.id, receiptNo: a.doc.receiptNo };
    const b = await makeSettledDoc(otherProfileId, '100.00');
    docB = { id: b.doc.id, receiptNo: b.doc.receiptNo };
  });

  afterAll(async () => {
    await prisma.financeDocument.deleteMany({
      where: { invoiceId: { in: invoiceIds } },
    });
    await prisma.refundAttempt.deleteMany({
      where: { invoiceId: { in: invoiceIds } },
    });
    await prisma.refund.deleteMany({
      where: { invoiceId: { in: invoiceIds } },
    });
    await prisma.payment.deleteMany({
      where: { invoiceId: { in: invoiceIds } },
    });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.feeComponent.deleteMany({ where: { structureId } });
    await prisma.feeStructure.deleteMany({ where: { id: structureId } });
    await prisma.guardianLink.deleteMany({ where: { id: guardianLinkId } });
    await prisma.studentProfile.deleteMany({ where: { id: otherProfileId } });
    await prisma.auditLog.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.user.deleteMany({ where: { id: { in: madeUserIds } } });
    await prisma.college.delete({ where: { id: rivalCollegeId } });
    await app.close();
  });

  const CONTRACT_KEYS = [
    'admissionNo',
    'amount',
    'balanceAfter',
    'collegeCode',
    'collegeName',
    'id',
    'invoiceAmount',
    'invoiceNo',
    'issuedAt',
    'kind',
    'method',
    'paidAt',
    'parentReceiptNo',
    'receiptNo',
    'receivedByName',
    'referenceMasked',
    'rollNo',
    'status',
    'structureName',
    'studentName',
    'voidReason',
    'voidedAt',
  ];

  it('anonymous → 401; teacher (no finance grants) → 403 on list and detail', async () => {
    expect((await http.get('/api/v1/fees/documents')).status).toBe(401);
    expect(
      (await http.get(`/api/v1/fees/documents/${docA.id}`)).status,
    ).toBe(401);
    expect(
      (await http.get('/api/v1/fees/documents').set(auth(teacherToken)))
        .status,
    ).toBe(403);
    expect(
      (
        await http
          .get(`/api/v1/fees/documents/${docA.id}`)
          .set(auth(teacherToken))
      ).status,
    ).toBe(403);
  });

  it('ALL scope: admin and accountant read any college document; list filters work', async () => {
    for (const token of [adminToken, accountantToken]) {
      const detail = await http
        .get(`/api/v1/fees/documents/${docB.id}`)
        .set(auth(token));
      expect(detail.status).toBe(200);
      expect(detail.body.data.receiptNo).toBe(docB.receiptNo);
    }
    const filtered = await http
      .get(`/api/v1/fees/documents?studentId=${otherProfileId}`)
      .set(auth(adminToken));
    expect(filtered.status).toBe(200);
    const numbers = filtered.body.data.map(
      (d: { receiptNo: string }) => d.receiptNo,
    );
    expect(numbers).toContain(docB.receiptNo);
    expect(numbers).not.toContain(docA.receiptNo);
  });

  it('OWN scope: student sees only own documents; another student’s doc is a 404, never a leak', async () => {
    const own = await http
      .get(`/api/v1/fees/documents/${docA.id}`)
      .set(auth(studentToken));
    expect(own.status).toBe(200);
    expect(own.body.data.receiptNo).toBe(docA.receiptNo);

    const foreign = await http
      .get(`/api/v1/fees/documents/${docB.id}`)
      .set(auth(studentToken));
    expect(foreign.status).toBe(404);
    const missing = await http
      .get('/api/v1/fees/documents/nonexistent-doc-id')
      .set(auth(studentToken));
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body); // indistinguishable

    const list = await http
      .get('/api/v1/fees/documents')
      .set(auth(studentToken));
    expect(list.status).toBe(200);
    const numbers = list.body.data.map(
      (d: { receiptNo: string }) => d.receiptNo,
    );
    expect(numbers).toContain(docA.receiptNo);
    expect(numbers).not.toContain(docB.receiptNo);
  });

  it('OWN scope ignores tampered query parameters (studentId/collegeId are not authority)', async () => {
    const res = await http
      .get(
        `/api/v1/fees/documents?studentId=${otherProfileId}&collegeId=${rivalCollegeId}`,
      )
      .set(auth(studentToken));
    expect(res.status).toBe(200);
    const numbers = res.body.data.map(
      (d: { receiptNo: string }) => d.receiptNo,
    );
    expect(numbers).toContain(docA.receiptNo);
    expect(numbers).not.toContain(docB.receiptNo);

    const badKind = await http
      .get('/api/v1/fees/documents?kind=HACKED')
      .set(auth(studentToken));
    expect(badKind.status).toBe(400);
  });

  it('CHILD scope: guardian needs an explicit linked child; unlinked child denied; revoked link denied', async () => {
    const noTarget = await http
      .get('/api/v1/fees/documents')
      .set(auth(guardianToken));
    expect(noTarget.status).toBe(400);
    expect(noTarget.body.error.code).toBe('MISSING_TARGET');

    const linked = await http
      .get(`/api/v1/fees/documents?studentId=${demoProfileId}`)
      .set(auth(guardianToken));
    expect(linked.status).toBe(200);
    expect(
      linked.body.data.map((d: { receiptNo: string }) => d.receiptNo),
    ).toContain(docA.receiptNo);

    const childDetail = await http
      .get(`/api/v1/fees/documents/${docA.id}`)
      .set(auth(guardianToken));
    expect(childDetail.status).toBe(200);

    // Unrelated student: denied without existence leak.
    const unrelatedList = await http
      .get(`/api/v1/fees/documents?studentId=${otherProfileId}`)
      .set(auth(guardianToken));
    expect(unrelatedList.status).toBe(403);
    const unrelatedDetail = await http
      .get(`/api/v1/fees/documents/${docB.id}`)
      .set(auth(guardianToken));
    expect(unrelatedDetail.status).toBe(404);

    // Revoked link removes ALL access.
    await prisma.guardianLink.update({
      where: { id: guardianLinkId },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    try {
      const revokedDetail = await http
        .get(`/api/v1/fees/documents/${docA.id}`)
        .set(auth(guardianToken));
      expect(revokedDetail.status).toBe(404);
      const revokedList = await http
        .get(`/api/v1/fees/documents?studentId=${demoProfileId}`)
        .set(auth(guardianToken));
      expect(revokedList.status).toBe(403);
    } finally {
      await prisma.guardianLink.update({
        where: { id: guardianLinkId },
        data: { status: 'ACTIVE', revokedAt: null },
      });
    }
  });

  it('cross-college: rival admin gets 404 identical to nonexistent; list shows nothing', async () => {
    const foreign = await http
      .get(`/api/v1/fees/documents/${docA.id}`)
      .set(auth(rivalAdminToken));
    expect(foreign.status).toBe(404);
    const missing = await http
      .get('/api/v1/fees/documents/totally-made-up')
      .set(auth(rivalAdminToken));
    expect(foreign.body).toEqual(missing.body);

    const list = await http
      .get('/api/v1/fees/documents')
      .set(auth(rivalAdminToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);
  });

  it('data minimization: the payload is exactly the frozen contract — no internal ids, no unmasked references', async () => {
    // Give the payment a reference-bearing sibling to prove masking.
    const invoice = await prisma.invoice.create({
      data: {
        collegeId,
        studentId: demoProfileId,
        structureId,
        invoiceNo: `W2FD-${suffix}-mask`,
        amount: '40.00',
        dueDate: new Date('2027-06-30'),
        status: 'PENDING',
      },
    });
    invoiceIds.push(invoice.id);
    await http
      .post(`/api/v1/fees/invoices/${invoice.id}/payments`)
      .set(auth(accountantToken))
      .send({ amount: 40, method: 'BANK_TRANSFER', reference: 'IBAN-PK00-SECRET-778899' });
    const payment = await prisma.payment.findFirstOrThrow({
      where: { invoiceId: invoice.id },
    });
    const doc = await prisma.financeDocument.findUniqueOrThrow({
      where: { paymentId: payment.id },
    });

    const res = await http
      .get(`/api/v1/fees/documents/${doc.id}`)
      .set(auth(studentToken));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(CONTRACT_KEYS);
    expect(res.body.data.referenceMasked).toBe('…778899');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('IBAN-PK00-SECRET');
    expect(raw).not.toContain(collegeId);
    expect(raw).not.toContain(payment.id);
    expect(raw).not.toContain(invoice.id);
  });

  it('reads return the frozen snapshot after upstream mutation and later money (read-path immutability)', async () => {
    const before = await http
      .get(`/api/v1/fees/documents/${docA.id}`)
      .set(auth(adminToken));

    const profile = await prisma.studentProfile.findUniqueOrThrow({
      where: { id: demoProfileId },
      select: { userId: true },
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: profile.userId },
    });
    const college = await prisma.college.findUniqueOrThrow({
      where: { id: collegeId },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { firstName: `W2Renamed-${suffix}` },
    });
    await prisma.college.update({
      where: { id: collegeId },
      data: { name: `W2 Renamed College ${suffix}` },
    });
    await prisma.feeStructure.update({
      where: { id: structureId },
      data: { name: `W2 renamed structure ${suffix}` },
    });
    // Later money: a RECORDED refund against payment A.
    const created = await http
      .post(`/api/v1/fees/payments/${paymentA}/refunds`)
      .set(auth(accountantToken))
      .send({
        amount: 30,
        currency: 'PKR',
        reason: 'read immutability probe',
        method: 'RECORDED',
      });
    expect(created.status).toBe(201);
    const exec = await http
      .post(`/api/v1/fees/refunds/${created.body.data.id}/execute`)
      .set(auth(accountantToken))
      .send({ confirmAmount: '30.00' });
    expect(exec.status).toBe(201);

    try {
      const after = await http
        .get(`/api/v1/fees/documents/${docA.id}`)
        .set(auth(adminToken));
      expect(after.body.data).toEqual(before.body.data); // byte-identical payload
      expect(after.body.data.balanceAfter).toBe(before.body.data.balanceAfter);

      // The refund document is independently readable with its OWN frozen
      // link to the parent receipt; the receipt itself stays ACTIVE.
      const refund = await prisma.refund.findFirstOrThrow({
        where: { paymentId: paymentA },
      });
      const refundDoc = await prisma.financeDocument.findUniqueOrThrow({
        where: { refundId: refund.id },
      });
      const rd = await http
        .get(`/api/v1/fees/documents/${refundDoc.id}`)
        .set(auth(studentToken)); // student reads their own refund document
      expect(rd.status).toBe(200);
      expect(rd.body.data.kind).toBe('REFUND_DOCUMENT');
      expect(rd.body.data.parentReceiptNo).toBe(docA.receiptNo);
      expect(JSON.stringify(rd.body)).not.toContain(
        'read immutability probe', // internal reason never leaves the API
      );
      expect(after.body.data.status).toBe('ACTIVE');
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

  it('VOID documents remain readable history: lifecycle fields change, frozen fields never', async () => {
    const made = await makeSettledDoc(demoProfileId, '55.00');
    const before = await http
      .get(`/api/v1/fees/documents/${made.doc.id}`)
      .set(auth(adminToken));
    const voided = await http
      .post(`/api/v1/fees/documents/${made.doc.id}/void`)
      .set(auth(adminToken))
      .send({ reason: 'void-read semantics test' });
    expect(voided.status).toBe(201);

    const after = await http
      .get(`/api/v1/fees/documents/${made.doc.id}`)
      .set(auth(adminToken));
    expect(after.status).toBe(200);
    expect(after.body.data.status).toBe('VOID');
    expect(after.body.data.voidReason).toBe('void-read semantics test');
    expect(after.body.data.voidedAt).toBeTruthy();
    // Every frozen field is unchanged.
    const strip = (d: Record<string, unknown>) => {
      const { status, voidReason, voidedAt, ...frozen } = d;
      return frozen;
    };
    expect(strip(after.body.data)).toEqual(strip(before.body.data));

    // Still present in the list — VOID is history, not deletion.
    const list = await http
      .get('/api/v1/fees/documents?kind=PAYMENT_RECEIPT')
      .set(auth(adminToken));
    expect(
      list.body.data.map((d: { receiptNo: string }) => d.receiptNo),
    ).toContain(made.doc.receiptNo);
  });

  it('reads never mutate: repeated reads leave the row byte-identical', async () => {
    const rowBefore = await prisma.financeDocument.findUniqueOrThrow({
      where: { id: docA.id },
    });
    for (let i = 0; i < 3; i += 1) {
      await http
        .get(`/api/v1/fees/documents/${docA.id}`)
        .set(auth(adminToken));
    }
    const rowAfter = await prisma.financeDocument.findUniqueOrThrow({
      where: { id: docA.id },
    });
    expect(rowAfter).toEqual(rowBefore);
  });

  it('legacy money without a document reads as absent — nothing is fabricated', async () => {
    const invoice = await prisma.invoice.create({
      data: {
        collegeId,
        studentId: demoProfileId,
        structureId,
        invoiceNo: `W2FD-${suffix}-legacy`,
        amount: '10.00',
        dueDate: new Date('2027-06-30'),
        status: 'PAID',
      },
    });
    invoiceIds.push(invoice.id);
    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amount: '10.00',
        method: 'CASH',
        paidAt: new Date(),
      },
    });
    const list = await http
      .get(`/api/v1/fees/documents?invoiceId=${invoice.id}`)
      .set(auth(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);
  });
});
