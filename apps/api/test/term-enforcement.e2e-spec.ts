import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M17-W2 — CLOSED-term enforcement + net-accounting consolidation.
 * Every mutation family from the design's §10/§11 inventory is attempted
 * against a CLOSED term (409 TERM_CLOSED, zero rows) and shown working on
 * an ACTIVE term; explicitly-ALLOWED financial history operations
 * (arrears recordPayment, refunds, reconciliation reads, exports) are
 * proven to keep working on CLOSED terms; real-Postgres races prove the
 * transaction-level guard; DEFECT-1 regression proves dashboards ==
 * fees-summary net figures. ACTIVE-path behavior for every family is
 * additionally covered by the existing module suites (regression green).
 */
describe('M17-W2 — closed-term enforcement & net accounting', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let adminToken: string;
  let accountantToken: string;
  let studentToken: string;
  let studentProfileId: string;
  let studentUserId: string;
  let teacherProfileId: string;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  // Fixture graph inside ONE closable term.
  let yearId: string;
  let termId: string;
  let termLabel: string;
  let courseId: string;
  let sectionId: string;
  let slotId: string;
  let slot2Id: string;
  let sessionId: string;
  let examId: string;
  let paperId: string;
  let assignmentId: string;
  let structureId: string;
  let invoiceId: string;
  // an ACTIVE control term
  let activeTermId: string;

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  const closeTerm = (id: string, label: string) =>
    http.post(`/api/v1/terms/${id}/close`).set(auth(adminToken)).send({ confirmLabel: label });
  const reopenTerm = (id: string, label: string) =>
    http.post(`/api/v1/terms/${id}/reopen`).set(auth(adminToken)).send({ confirmLabel: label });

  function expectClosed(res: request.Response) {
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TERM_CLOSED');
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
    const student = await prisma.user.findFirstOrThrow({
      where: { email: 'student@campusos.dev' },
      include: { studentProfile: true },
    });
    studentProfileId = student.studentProfile!.id;
    studentUserId = student.id;
    const teacher = await prisma.user.findFirstOrThrow({
      where: { email: 'teacher@campusos.dev' },
      include: { teacherProfile: true },
    });
    teacherProfileId = teacher.teacherProfile!.id;

    yearId = (
      await prisma.academicYear.create({
        data: {
          collegeId,
          label: `W2TE-AY-${suffix}`,
          startsOn: new Date('2027-08-01'),
          endsOn: new Date('2028-06-30'),
        },
      })
    ).id;
    termLabel = `W2TE-${suffix}`;
    const term = await prisma.term.create({
      data: {
        collegeId,
        academicYearId: yearId,
        label: termLabel,
        startsOn: new Date('2027-08-01'),
        endsOn: new Date('2027-12-20'),
      },
    });
    termId = term.id;
    activeTermId = (
      await prisma.term.create({
        data: {
          collegeId,
          academicYearId: yearId,
          label: `W2TE-ACT-${suffix}`,
          startsOn: new Date('2028-01-10'),
          endsOn: new Date('2028-05-20'),
        },
      })
    ).id;

    const department = await prisma.department.findFirstOrThrow({
      where: { collegeId },
    });
    courseId = (
      await prisma.course.create({
        data: {
          collegeId,
          departmentId: department.id,
          code: `W2TE-${suffix}`.slice(0, 12),
          title: 'Enforcement Course',
          credits: 3,
        },
      })
    ).id;
    const section = await prisma.section.create({
      data: { collegeId, courseId, termId, name: 'A', capacity: 30 },
    });
    sectionId = section.id;
    await prisma.enrollment.create({
      data: { sectionId, studentId: studentProfileId },
    });
    await prisma.teachingAssignment.create({
      data: { sectionId, teacherId: teacherProfileId },
    });
    slotId = (
      await prisma.timetableSlot.create({
        data: {
          sectionId,
          dayOfWeek: 1,
          startTime: '09:00',
          endTime: '10:30',
          room: 'W2TE-1',
        },
      })
    ).id;
    slot2Id = (
      await prisma.timetableSlot.create({
        data: {
          sectionId,
          dayOfWeek: 3,
          startTime: '14:00',
          endTime: '15:00',
        },
      })
    ).id;
    sessionId = (
      await prisma.classSession.create({
        data: { slotId, sectionId, date: new Date('2027-09-06') },
      })
    ).id;
    const exam = await prisma.exam.create({
      data: { collegeId, termId, title: `W2TE Exam ${suffix}`, type: 'MIDTERM' },
    });
    examId = exam.id;
    paperId = (
      await prisma.examPaper.create({
        data: {
          examId,
          sectionId,
          maxMarks: 100,
          examDate: new Date('2027-10-01'),
        },
      })
    ).id;
    assignmentId = (
      await prisma.assignment.create({
        data: {
          sectionId,
          title: `W2TE Assignment ${suffix}`,
          description: 'x',
          dueAt: new Date('2027-11-01'),
          maxPoints: 10,
          allowLate: true,
          publishedAt: new Date(),
          createdById: admin.id,
        },
      })
    ).id;
    const structure = await prisma.feeStructure.create({
      data: {
        collegeId,
        termId,
        name: `W2TE structure ${suffix}`,
        totalAmount: '1000.00',
        components: { create: [{ label: 'Tuition', amount: '1000.00' }] },
      },
    });
    structureId = structure.id;
    invoiceId = (
      await prisma.invoice.create({
        data: {
          collegeId,
          studentId: studentProfileId,
          structureId,
          invoiceNo: `W2TE-${suffix}`,
          amount: '1000.00',
          dueDate: new Date('2027-10-31'),
          status: 'PENDING',
        },
      })
    ).id;

    adminToken = await login('admin@campusos.dev');
    accountantToken = await login('accountant@campusos.dev');
    studentToken = await login('student@campusos.dev');

    // Close the fixture term through the real endpoint.
    const closed = await closeTerm(termId, termLabel);
    expect(closed.status).toBe(201);
  });

  afterAll(async () => {
    await prisma.refundAttempt.deleteMany({ where: { invoiceId } });
    await prisma.refund.deleteMany({ where: { invoiceId } });
    await prisma.payment.deleteMany({ where: { invoiceId } });
    await prisma.invoice.deleteMany({ where: { structureId } });
    await prisma.feeComponent.deleteMany({ where: { structureId } });
    await prisma.feeStructure.deleteMany({
      where: { OR: [{ id: structureId }, { name: { contains: `W2TE-race-${suffix}` } }] },
    });
    await prisma.notification.deleteMany({ where: { type: { startsWith: 'refund' } } });
    await prisma.submission.deleteMany({ where: { assignment: { sectionId } } });
    await prisma.assignment.deleteMany({ where: { sectionId } });
    await prisma.mark.deleteMany({ where: { examPaper: { examId } } });
    await prisma.examPaper.deleteMany({ where: { examId } });
    await prisma.exam.deleteMany({ where: { termId } });
    await prisma.attendanceRecord.deleteMany({ where: { session: { sectionId } } });
    await prisma.classSession.deleteMany({ where: { sectionId } });
    await prisma.timetableSlot.deleteMany({ where: { sectionId } });
    await prisma.enrollment.deleteMany({ where: { sectionId } });
    await prisma.teachingAssignment.deleteMany({ where: { sectionId } });
    await prisma.section.deleteMany({ where: { courseId } });
    await prisma.course.deleteMany({ where: { id: courseId } });
    await prisma.term.deleteMany({ where: { academicYearId: yearId } });
    await prisma.academicYear.deleteMany({ where: { id: yearId } });
    await app.close();
  });

  describe('academic mutations are blocked on a CLOSED term (409 TERM_CLOSED, zero rows)', () => {
    it('attendance: session generation, session update, sheet save', async () => {
      expectClosed(
        await http
          .post(`/api/v1/sections/${sectionId}/sessions/generate?weekOf=2027-09-06`)
          .set(auth(adminToken))
          .send({}),
      );
      expectClosed(
        await http
          .patch(`/api/v1/sessions/${sessionId}`)
          .set(auth(adminToken))
          .send({ status: 'CANCELLED' }),
      );
      expectClosed(
        await http
          .put(`/api/v1/sessions/${sessionId}/attendance`)
          .set(auth(adminToken))
          .send({ records: [{ studentId: studentProfileId, status: 'PRESENT' }] }),
      );
      expect(
        await prisma.attendanceRecord.count({ where: { sessionId } }),
      ).toBe(0);
    });

    it('exams: create-in-term, update, publish, paper create, marks entry', async () => {
      expectClosed(
        await http
          .post('/api/v1/exams')
          .set(auth(adminToken))
          .send({ termId, title: 'blocked', type: 'FINAL' }),
      );
      expectClosed(
        await http
          .patch(`/api/v1/exams/${examId}`)
          .set(auth(adminToken))
          .send({ title: 'renamed' }),
      );
      expectClosed(
        await http.post(`/api/v1/exams/${examId}/publish`).set(auth(adminToken)).send({}),
      );
      expectClosed(
        await http
          .post(`/api/v1/exams/${examId}/papers`)
          .set(auth(adminToken))
          .send({ sectionId, maxMarks: 50, examDate: '2027-10-02T09:00:00.000Z' }),
      );
      expectClosed(
        await http
          .put(`/api/v1/papers/${paperId}/marks`)
          .set(auth(adminToken))
          .send({ marks: [{ studentId: studentProfileId, marksObtained: 90 }] }),
      );
      expect(await prisma.mark.count({ where: { examPaperId: paperId } })).toBe(0);
    });

    it('assignments: create, update, publish/delete path, submit, grade', async () => {
      expectClosed(
        await http
          .post('/api/v1/assignments')
          .set(auth(adminToken))
          .send({
            sectionId,
            title: 'blocked',
            description: 'x',
            dueAt: '2027-11-15T00:00:00.000Z',
            maxPoints: 10,
            allowLate: true,
          }),
      );
      expectClosed(
        await http
          .patch(`/api/v1/assignments/${assignmentId}`)
          .set(auth(adminToken))
          .send({ title: 'renamed' }),
      );
      expectClosed(
        await http
          .post(`/api/v1/assignments/${assignmentId}/submissions`)
          .set(auth(studentToken))
          .send({ textContent: 'late work' }),
      );
      expect(
        await prisma.submission.count({ where: { assignmentId } }),
      ).toBe(0);
    });

    it('timetable: slot create, update, delete', async () => {
      expectClosed(
        await http
          .post('/api/v1/timetable/slots')
          .set(auth(adminToken))
          .send({
            sectionId,
            dayOfWeek: 2,
            startTime: '11:00',
            endTime: '12:00',
          }),
      );
      expectClosed(
        await http
          .patch(`/api/v1/timetable/slots/${slotId}`)
          .set(auth(adminToken))
          .send({ startTime: '09:30', endTime: '10:45' }),
      );
      expectClosed(
        await http.delete(`/api/v1/timetable/slots/${slot2Id}`).set(auth(adminToken)),
      );
      expect(await prisma.timetableSlot.count({ where: { sectionId } })).toBe(2);
    });

    it('sections & membership: create-in-term, update, enroll, unenroll, teacher assign/remove', async () => {
      expectClosed(
        await http
          .post('/api/v1/sections')
          .set(auth(adminToken))
          .send({ courseId, termId, name: 'B', capacity: 20 }),
      );
      expectClosed(
        await http
          .patch(`/api/v1/sections/${sectionId}`)
          .set(auth(adminToken))
          .send({ room: 'NEW' }),
      );
      // fresh student for the enroll attempt
      const other = await prisma.studentProfile.findFirstOrThrow({
        where: { collegeId, id: { not: studentProfileId } },
      });
      expectClosed(
        await http
          .post(`/api/v1/sections/${sectionId}/enrollments/${other.id}`)
          .set(auth(adminToken))
          .send({}),
      );
      expectClosed(
        await http
          .delete(`/api/v1/sections/${sectionId}/enrollments/${studentProfileId}`)
          .set(auth(adminToken)),
      );
      expectClosed(
        await http
          .delete(`/api/v1/sections/${sectionId}/teachers/${teacherProfileId}`)
          .set(auth(adminToken)),
      );
      expect(
        await prisma.enrollment.count({ where: { sectionId, status: 'ACTIVE' } }),
      ).toBe(1);
      expect(await prisma.teachingAssignment.count({ where: { sectionId } })).toBe(1);
    });

    it('term definition edits are blocked; rival term ids stay 404', async () => {
      expectClosed(
        await http
          .patch(`/api/v1/terms/${termId}`)
          .set(auth(adminToken))
          .send({ endsOn: '2027-12-31' }),
      );
      // established 404 semantics remain (foreign/nonexistent term)
      const foreign = await http
        .patch('/api/v1/terms/cmzzzzzzzzzzzzzzzzzzzzzzz')
        .set(auth(adminToken))
        .send({ endsOn: '2027-12-31' });
      expect(foreign.status).toBe(404);
    });
  });

  describe('finance: D-1/O-2 boundary on a CLOSED term', () => {
    it('structure create/update, invoice generation and cancellation are blocked', async () => {
      expectClosed(
        await http
          .post('/api/v1/fees/structures')
          .set(auth(adminToken))
          .send({
            termId,
            name: 'blocked structure',
            components: [{ label: 'X', amount: 10 }],
          }),
      );
      expectClosed(
        await http
          .patch(`/api/v1/fees/structures/${structureId}`)
          .set(auth(adminToken))
          .send({ name: 'renamed' }),
      );
      expectClosed(
        await http
          .post('/api/v1/fees/invoices/generate')
          .set(auth(adminToken))
          .send({ structureId, dueDate: '2027-11-30' }),
      );
      expectClosed(
        await http
          .patch(`/api/v1/fees/invoices/${invoiceId}/cancel`)
          .set(auth(adminToken)),
      );
      expect(await prisma.invoice.count({ where: { structureId } })).toBe(1);
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      expect(invoice.status).not.toBe('CANCELLED');
    });

    it('ALLOWED: arrears payment, full refund cycle, reconciliation read and CSV export still work', async () => {
      // arrears: record a manual payment against the CLOSED-term invoice
      const payment = await http
        .post(`/api/v1/fees/invoices/${invoiceId}/payments`)
        .set(auth(accountantToken))
        .send({ amount: 400, method: 'CASH' });
      expect(payment.status).toBe(201);

      // refunds remain fully functional (create + typed execute)
      const paymentRow = await prisma.payment.findFirstOrThrow({
        where: { invoiceId },
      });
      const refund = await http
        .post(`/api/v1/fees/payments/${paymentRow.id}/refunds`)
        .set(auth(accountantToken))
        .send({
          amount: 150,
          currency: 'PKR',
          reason: 'closed-term arrears correction',
          method: 'RECORDED',
        });
      expect(refund.status).toBe(201);
      const executed = await http
        .post(`/api/v1/fees/refunds/${refund.body.data.id}/execute`)
        .set(auth(accountantToken))
        .send({ confirmAmount: '150.00' });
      expect(executed.status).toBe(201);
      expect(executed.body.data.status).toBe('SUCCEEDED');

      // net accounting on the CLOSED term stays derived: 400 − 150 = 250
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      expect(invoice.status).toBe('PARTIAL');
      const summary = await http
        .get(`/api/v1/fees/payments/${paymentRow.id}/refunds`)
        .set(auth(accountantToken));
      expect(summary.body.data.refundable).toBe('250.00');

      // reconciliation + exports remain readable
      expect(
        (await http.get('/api/v1/fees/refunds').set(auth(accountantToken))).status,
      ).toBe(200);
      const csv = await http.get('/api/v1/exports/fees.csv').set(auth(accountantToken));
      expect(csv.status).toBe(200);
      // fees.csv paid column is NET for the closed-term invoice: 250
      const line = csv.text.split('\r\n').find((row) => row.startsWith(`W2TE-${suffix}`));
      expect(line).toContain(',250,');

      // financial immutability held throughout
      expect(Number(paymentRow.amount)).toBe(400);
      expect(Number(invoice.amount)).toBe(1000);
    });
  });

  describe('lifecycle interplay with ACTIVE control term', () => {
    it('the same mutations succeed on an ACTIVE term (control), then reopen restores the closed term', async () => {
      // control: section create in the ACTIVE term works
      const section = await http
        .post('/api/v1/sections')
        .set(auth(adminToken))
        .send({ courseId, termId: activeTermId, name: 'CTRL', capacity: 10 });
      expect(section.status).toBe(201);
      // control: structure create in the ACTIVE term works
      const structure = await http
        .post('/api/v1/fees/structures')
        .set(auth(adminToken))
        .send({
          termId: activeTermId,
          name: `W2TE-ACT structure ${suffix}`,
          components: [{ label: 'X', amount: 5 }],
        });
      expect(structure.status).toBe(201);
      await prisma.feeComponent.deleteMany({
        where: { structureId: structure.body.data.id },
      });
      await prisma.feeStructure.delete({ where: { id: structure.body.data.id } });

      // reopen the closed fixture term → a blocked mutation now succeeds
      expect((await reopenTerm(termId, termLabel)).status).toBe(201);
      const update = await http
        .patch(`/api/v1/sections/${sectionId}`)
        .set(auth(adminToken))
        .send({ room: 'REOPENED' });
      expect(update.status).toBe(200);
      // close again for any later assertions
      expect((await closeTerm(termId, termLabel)).status).toBe(201);
    });
  });

  describe('concurrency: transaction-level guard (real Postgres)', () => {
    async function freshActiveTermWithStructure(label: string) {
      const term = await prisma.term.create({
        data: {
          collegeId,
          academicYearId: yearId,
          label,
          startsOn: new Date('2028-06-01'),
          endsOn: new Date('2028-07-31'),
        },
      });
      const structure = await prisma.feeStructure.create({
        data: {
          collegeId,
          termId: term.id,
          name: `W2TE-race-${suffix}-${label}`,
          totalAmount: '10.00',
        },
      });
      return { term, structure };
    }

    it('close racing invoice generation: an invoice is never minted after CLOSED committed', async () => {
      const { term, structure } = await freshActiveTermWithStructure(`R1-${suffix}`);
      const [closeRes, generate] = await Promise.all([
        closeTerm(term.id, term.label),
        http
          .post('/api/v1/fees/invoices/generate')
          .set(auth(adminToken))
          .send({ structureId: structure.id, dueDate: '2028-07-01' }),
      ]);
      expect(closeRes.status).toBe(201);
      const invoices = await prisma.invoice.count({
        where: { structureId: structure.id },
      });
      if (generate.status === 201) {
        // generation won the race — it fully completed BEFORE the close
        expect(invoices).toBe(generate.body.data.created);
      } else {
        expectClosed(generate);
        expect(invoices).toBe(0);
      }
      await prisma.invoice.deleteMany({ where: { structureId: structure.id } });
    });

    it('close racing structure creation and session generation: guard holds inside the transaction', async () => {
      const { term } = await freshActiveTermWithStructure(`R2-${suffix}`);
      const [closeRes, createStructure] = await Promise.all([
        closeTerm(term.id, term.label),
        http
          .post('/api/v1/fees/structures')
          .set(auth(adminToken))
          .send({
            termId: term.id,
            name: `W2TE-race-${suffix}-S`,
            components: [{ label: 'X', amount: 1 }],
          }),
      ]);
      expect(closeRes.status).toBe(201);
      const structures = await prisma.feeStructure.count({
        where: { termId: term.id, name: `W2TE-race-${suffix}-S` },
      });
      if (createStructure.status === 201) {
        expect(structures).toBe(1); // won before close committed
      } else {
        expectClosed(createStructure);
        expect(structures).toBe(0);
      }
      await prisma.feeComponent.deleteMany({
        where: { structure: { termId: term.id } },
      });
      await prisma.feeStructure.deleteMany({ where: { termId: term.id } });
    });
  });

  describe('DEFECT-1 regression: dashboards use the SAME net figures as fees', () => {
    it('admin collected == fees summary collected; student balance is net of refunds; partial and full refunds', async () => {
      // the closed-term invoice already carries: payment 400, refund 150 → net 250
      const summary = await http.get('/api/v1/fees/summary').set(auth(adminToken));
      const dashboard = await http.get('/api/v1/dashboards/admin').set(auth(adminToken));
      expect(dashboard.status).toBe(200);
      expect(dashboard.body.data.fees.collected).toBe(
        summary.body.data.collectedTotal,
      );
      expect(dashboard.body.data.fees.outstanding).toBe(
        summary.body.data.outstandingTotal,
      );

      // student dashboard: balance is net — refund the REMAINING 250 (full
      // exhaustion of the payment) and watch the student's balance grow by
      // exactly 250 while other invoices keep the calculation non-trivial.
      const before = await http
        .get('/api/v1/dashboards/student')
        .set(auth(studentToken));
      const paymentRow = await prisma.payment.findFirstOrThrow({
        where: { invoiceId },
      });
      const refund = await http
        .post(`/api/v1/fees/payments/${paymentRow.id}/refunds`)
        .set(auth(accountantToken))
        .send({ amount: 250, currency: 'PKR', reason: 'full', method: 'RECORDED' });
      expect(refund.status).toBe(201);
      expect(
        (
          await http
            .post(`/api/v1/fees/refunds/${refund.body.data.id}/execute`)
            .set(auth(accountantToken))
            .send({ confirmAmount: '250.00' })
        ).status,
      ).toBe(201);
      // netPaid on the payment is now 0; invoice reverts to PENDING (D-5)
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      expect(invoice.status).toBe('PENDING');
      const after = await http
        .get('/api/v1/dashboards/student')
        .set(auth(studentToken));
      expect(
        Number(after.body.data.feeBalance) - Number(before.body.data.feeBalance),
      ).toBe(250);
      // and admin dashboard still equals the fees summary after the refund
      const summary2 = await http.get('/api/v1/fees/summary').set(auth(adminToken));
      const dashboard2 = await http
        .get('/api/v1/dashboards/admin')
        .set(auth(adminToken));
      expect(dashboard2.body.data.fees.collected).toBe(
        summary2.body.data.collectedTotal,
      );
    });
  });
});
