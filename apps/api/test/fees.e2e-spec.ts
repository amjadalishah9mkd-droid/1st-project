import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';
const ADMIN = 'admin@campusos.dev';
const TEACHER = 'teacher@campusos.dev';
const STUDENT = 'student@campusos.dev';

const flush = () => new Promise((resolve) => setTimeout(resolve, 300));

describe('M6 — Fees', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  const suffix = Date.now().toString(36).toUpperCase();
  const cleanups: Array<() => Promise<unknown>> = [];
  let structureId: string;
  let demoStudentProfileId: string;
  let demoStudentUserId: string;
  let demoInvoiceId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    app.get(LoginRateLimiterService).reset();
    http = request(app.getHttpServer());

    const token = async (email: string) => {
      const res = await http
        .post('/api/v1/auth/login')
        .send({ email, password: DEMO_PASSWORD });
      expect(res.status).toBe(200);
      return res.body.data.accessToken as string;
    };
    adminToken = await token(ADMIN);
    teacherToken = await token(TEACHER);
    studentToken = await token(STUDENT);

    const studentProfile = await prisma.studentProfile.findFirstOrThrow({
      where: { user: { email: STUDENT } },
    });
    demoStudentProfileId = studentProfile.id;
    demoStudentUserId = studentProfile.userId;

    cleanups.push(async () => {
      // M20-W1: issued documents Restrict money-row deletion — clear first.
      await prisma.financeDocument.deleteMany({
        where: { invoice: { structure: { name: { contains: suffix } } } },
      });
      await prisma.payment.deleteMany({
        where: { invoice: { structure: { name: { contains: suffix } } } },
      });
      await prisma.invoice.deleteMany({
        where: { structure: { name: { contains: suffix } } },
      });
      await prisma.feeComponent.deleteMany({
        where: { structure: { name: { contains: suffix } } },
      });
      await prisma.feeStructure.deleteMany({
        where: { name: { contains: suffix } },
      });
      await prisma.notification.deleteMany({
        where: { userId: demoStudentUserId, type: 'invoice.issued' },
      });
    });
  });

  afterAll(async () => {
    for (const cleanup of cleanups.reverse()) {
      await cleanup().catch(() => undefined);
    }
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const futureDate = new Date(Date.now() + 20 * 86400000)
    .toISOString()
    .slice(0, 10);

  // ── Structures ─────────────────────────────────────────────

  it('admin creates a course-scoped structure; total = component sum', async () => {
    const course = await prisma.course.findFirstOrThrow({ where: { code: 'CS-101' } });
    const term = await prisma.term.findFirstOrThrow({ where: { isCurrent: true } });
    const res = await http
      .post('/api/v1/fees/structures')
      .set(auth(adminToken))
      .send({
        termId: term.id,
        courseId: course.id,
        name: `CS Lab Fee ${suffix}`,
        components: [
          { label: 'Lab access', amount: 120 },
          { label: 'Materials', amount: 30 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.totalAmount).toBe('150');
    expect(res.body.data.components).toHaveLength(2);
    structureId = res.body.data.id;
  });

  it('teacher and student cannot manage structures or generate invoices', async () => {
    for (const t of [teacherToken, studentToken]) {
      const create = await http
        .post('/api/v1/fees/structures')
        .set(auth(t))
        .send({});
      expect(create.status).toBe(403);
      const generate = await http
        .post('/api/v1/fees/invoices/generate')
        .set(auth(t))
        .send({ structureId, dueDate: futureDate });
      expect(generate.status).toBe(403);
      const summary = await http.get('/api/v1/fees/summary').set(auth(t));
      expect(summary.status).toBe(403);
    }
  });

  it('rejects structures with invalid term/course references', async () => {
    const term = await prisma.term.findFirstOrThrow({ where: { isCurrent: true } });
    const badCourse = await http
      .post('/api/v1/fees/structures')
      .set(auth(adminToken))
      .send({
        termId: term.id,
        courseId: 'nonexistent',
        name: `Bad ${suffix}`,
        components: [{ label: 'X', amount: 10 }],
      });
    expect(badCourse.status).toBe(400);
    expect(badCourse.body.error.code).toBe('INVALID_COURSE');
  });

  // ── Generation ─────────────────────────────────────────────

  it('generates invoices for the course audience; re-run skips existing; notifications created', async () => {
    const before = await prisma.notification.count({
      where: { userId: demoStudentUserId, type: 'invoice.issued' },
    });

    const first = await http
      .post('/api/v1/fees/invoices/generate')
      .set(auth(adminToken))
      .send({ structureId, dueDate: futureDate });
    expect(first.status).toBe(201);
    // CS-101/A has 6 enrolled students in the demo seed.
    expect(first.body.data.created).toBeGreaterThanOrEqual(6);
    expect(first.body.data.skipped).toBe(0);
    const created = first.body.data.created;

    const second = await http
      .post('/api/v1/fees/invoices/generate')
      .set(auth(adminToken))
      .send({ structureId, dueDate: futureDate });
    expect(second.status).toBe(201);
    expect(second.body.data.created).toBe(0);
    expect(second.body.data.skipped).toBe(created);

    await flush();
    const after = await prisma.notification.count({
      where: { userId: demoStudentUserId, type: 'invoice.issued' },
    });
    expect(after).toBe(before + 1); // demo student is in CS-101/A

    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { structureId, studentId: demoStudentProfileId },
    });
    demoInvoiceId = invoice.id;
    expect(invoice.amount.toString()).toBe('150'); // snapshot of total
  });

  // ── Scoping ────────────────────────────────────────────────

  it('student sees only own invoices; studentId filter cannot leak others', async () => {
    const list = await http
      .get('/api/v1/fees/invoices?limit=100')
      .set(auth(studentToken));
    expect(list.status).toBe(200);
    const rows = list.body.data as Array<{ studentId: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.studentId === demoStudentProfileId)).toBe(true);

    const other = await prisma.studentProfile.findFirstOrThrow({
      where: { id: { not: demoStudentProfileId } },
    });
    const filtered = await http
      .get(`/api/v1/fees/invoices?limit=100&studentId=${other.id}`)
      .set(auth(studentToken));
    expect(
      (filtered.body.data as Array<{ studentId: string }>).every(
        (row) => row.studentId === demoStudentProfileId,
      ),
    ).toBe(true);

    // Detail of another student's invoice is invisible.
    const foreign = await prisma.invoice.findFirstOrThrow({
      where: { studentId: { not: demoStudentProfileId } },
    });
    const denied = await http
      .get(`/api/v1/fees/invoices/${foreign.id}`)
      .set(auth(studentToken));
    expect(denied.status).toBe(404);
  });

  it('teacher has no fee access at all', async () => {
    const res = await http.get('/api/v1/fees/invoices').set(auth(teacherToken));
    expect(res.status).toBe(403);
  });

  // ── Payments & status engine ───────────────────────────────

  it('partial payment → PARTIAL; overpayment rejected; full payment → PAID', async () => {
    const partial = await http
      .post(`/api/v1/fees/invoices/${demoInvoiceId}/payments`)
      .set(auth(adminToken))
      .send({ amount: 50, method: 'CASH' });
    expect(partial.status).toBe(201);
    expect(partial.body.data.status).toBe('PARTIAL');
    expect(partial.body.data.balance).toBe('100');

    const over = await http
      .post(`/api/v1/fees/invoices/${demoInvoiceId}/payments`)
      .set(auth(adminToken))
      .send({ amount: 200, method: 'CASH' });
    expect(over.status).toBe(400);
    expect(over.body.error.code).toBe('OVERPAYMENT');

    const full = await http
      .post(`/api/v1/fees/invoices/${demoInvoiceId}/payments`)
      .set(auth(adminToken))
      .send({ amount: 100, method: 'BANK_TRANSFER', reference: 'T-1' });
    expect(full.status).toBe(201);
    expect(full.body.data.status).toBe('PAID');
    expect(full.body.data.balance).toBe('0');
    expect(full.body.data.payments).toHaveLength(2);

    // Paid invoice rejects further payments (balance 0 → overpayment).
    const extra = await http
      .post(`/api/v1/fees/invoices/${demoInvoiceId}/payments`)
      .set(auth(adminToken))
      .send({ amount: 1, method: 'CASH' });
    expect(extra.status).toBe(400);
  });

  it('students cannot record payments', async () => {
    const res = await http
      .post(`/api/v1/fees/invoices/${demoInvoiceId}/payments`)
      .set(auth(studentToken))
      .send({ amount: 1, method: 'CASH' });
    expect(res.status).toBe(403);
  });

  it('cancel: blocked with payments; works on unpaid; cancelled rejects payments', async () => {
    const withPayments = await http
      .patch(`/api/v1/fees/invoices/${demoInvoiceId}/cancel`)
      .set(auth(adminToken));
    expect(withPayments.status).toBe(409);
    expect(withPayments.body.error.code).toBe('HAS_PAYMENTS');

    const unpaid = await prisma.invoice.findFirstOrThrow({
      where: { structureId, payments: { none: {} } },
    });
    const cancelled = await http
      .patch(`/api/v1/fees/invoices/${unpaid.id}/cancel`)
      .set(auth(adminToken));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    const payCancelled = await http
      .post(`/api/v1/fees/invoices/${unpaid.id}/payments`)
      .set(auth(adminToken))
      .send({ amount: 10, method: 'CASH' });
    expect(payCancelled.status).toBe(400);
    expect(payCancelled.body.error.code).toBe('INVOICE_CANCELLED');
  });

  it('past-due unpaid invoices transition to OVERDUE on read', async () => {
    const college = await prisma.college.findFirstOrThrow({ where: { code: 'CAMPUS-01' } });
    const target = await prisma.studentProfile.findFirstOrThrow({
      where: {
        id: { not: demoStudentProfileId },
        invoices: { none: { structureId } },
      },
    });
    const stale = await prisma.invoice.create({
      data: {
        collegeId: college.id,
        studentId: target.id,
        structureId,
        invoiceNo: `INV-T-${suffix}`,
        amount: 150,
        dueDate: new Date(Date.now() - 86400000),
        status: 'PENDING',
      },
    });
    const res = await http
      .get(`/api/v1/fees/invoices/${stale.id}`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('OVERDUE');
  });

  it('summary aggregates real totals (admin only)', async () => {
    const res = await http.get('/api/v1/fees/summary').set(auth(adminToken));
    expect(res.status).toBe(200);
    const summary = res.body.data;
    expect(Number(summary.invoicedTotal)).toBeGreaterThan(0);
    expect(Number(summary.collectedTotal)).toBeGreaterThan(0);
    expect(Number(summary.outstandingTotal)).toBe(
      Number(summary.invoicedTotal) - Number(summary.collectedTotal),
    );
    expect(summary.overdueCount).toBeGreaterThanOrEqual(1);
  });

  // ── Tenant isolation & auth ─────────────────────────────────

  it('tenant isolation: other-college structures/invoices are invisible', async () => {
    const rival = await prisma.college.create({
      data: { name: 'Rival6', code: `RIVAL6-${suffix}` },
    });
    const rivalYear = await prisma.academicYear.create({
      data: {
        collegeId: rival.id,
        label: 'RY6',
        startsOn: new Date('2026-01-01'),
        endsOn: new Date('2026-12-31'),
      },
    });
    const rivalTerm = await prisma.term.create({
      data: {
        collegeId: rival.id,
        academicYearId: rivalYear.id,
        label: 'RT6',
        startsOn: new Date('2026-01-01'),
        endsOn: new Date('2026-12-31'),
      },
    });
    const rivalStructure = await prisma.feeStructure.create({
      data: {
        collegeId: rival.id,
        termId: rivalTerm.id,
        name: 'Rival fee',
        totalAmount: 99,
      },
    });
    cleanups.push(async () => {
      await prisma.feeStructure.delete({ where: { id: rivalStructure.id } });
      await prisma.term.delete({ where: { id: rivalTerm.id } });
      await prisma.academicYear.delete({ where: { id: rivalYear.id } });
      await prisma.college.delete({ where: { id: rival.id } });
    });

    const generate = await http
      .post('/api/v1/fees/invoices/generate')
      .set(auth(adminToken))
      .send({ structureId: rivalStructure.id, dueDate: futureDate });
    expect(generate.status).toBe(404);

    const list = await http
      .get('/api/v1/fees/structures?limit=100')
      .set(auth(adminToken));
    expect(
      (list.body.data as Array<{ id: string }>).some((s) => s.id === rivalStructure.id),
    ).toBe(false);
  });

  it('unauthenticated requests are rejected on M6 surfaces', async () => {
    for (const path of [
      '/api/v1/fees/structures',
      '/api/v1/fees/invoices',
      '/api/v1/fees/summary',
    ]) {
      const res = await http.get(path);
      expect(res.status).toBe(401);
    }
  });
});
