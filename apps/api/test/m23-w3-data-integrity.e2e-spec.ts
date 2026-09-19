import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M23-W3 — data-integrity fixes for D-4, D-1 and D-2.
 *
 *  D-4 fee-structure component replacement took no row lock, so
 *      concurrent writers interleaved and left
 *      totalAmount != SUM(component amounts).
 *  D-1 GET /exports/fees.csv?termId= spread `termId` onto Invoice, which
 *      has no such column, producing a 500.
 *  D-2 updateGradeBands deleted and recreated bands without gradePoint,
 *      silently erasing any configured GPA scale.
 *
 * All fixtures are disposable and removed FK-safely. Demo accounts are
 * used only as authenticated principals, never as lifecycle targets, and
 * the demo college's own grade bands are snapshotted and restored.
 */
describe('M23-W3 — data integrity (D-4, D-1, D-2)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  const tag = `m23w3-${suffix}`;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let collegeId: string;
  let departmentId: string;
  let adminUserId: string;
  let passwordHash: string;

  let adminToken: string;
  let accountantToken: string;
  let teacherToken: string;
  let studentToken: string;

  let yearId: string;
  let termAId: string;
  let termBId: string;
  let courseId: string;
  let structureId: string; // term A
  let structureBId: string; // term B
  let studentProfileId: string;
  let invoiceAId: string;
  let invoiceBId: string;

  let rivalCollegeId: string;
  let rivalTermId: string;
  let rivalStructureId: string;

  /** Demo grade bands, snapshotted so the demo college is left byte-identical. */
  let bandSnapshot: Array<{
    label: string;
    minPercent: string;
    maxPercent: string;
    gradePoint: string | null;
    sortOrder: number;
  }> = [];

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  /** The D-4 invariant, read from committed state. */
  async function assertTotalMatchesComponents(id: string) {
    const row = await prisma.feeStructure.findUniqueOrThrow({
      where: { id },
      include: { components: true },
    });
    const sum = row.components.reduce((s, c) => s + Number(c.amount), 0);
    expect(Number(row.totalAmount)).toBe(sum);
    return { total: Number(row.totalAmount), sum, components: row.components };
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
    adminUserId = admin.id;
    passwordHash = admin.passwordHash!;
    departmentId = (
      await prisma.department.findFirstOrThrow({ where: { collegeId } })
    ).id;

    bandSnapshot = (
      await prisma.gradeBand.findMany({
        where: { collegeId },
        orderBy: { sortOrder: 'asc' },
      })
    ).map((b) => ({
      label: b.label,
      minPercent: b.minPercent.toString(),
      maxPercent: b.maxPercent.toString(),
      gradePoint: b.gradePoint === null ? null : b.gradePoint.toString(),
      sortOrder: b.sortOrder,
    }));

    yearId = (
      await prisma.academicYear.create({
        data: {
          collegeId,
          label: `${tag}-AY`,
          startsOn: new Date('2034-08-01'),
          endsOn: new Date('2035-06-30'),
        },
      })
    ).id;
    const mkTerm = async (label: string, from: string, to: string) =>
      (
        await prisma.term.create({
          data: {
            collegeId,
            academicYearId: yearId,
            label,
            startsOn: new Date(from),
            endsOn: new Date(to),
            status: 'ACTIVE',
          },
        })
      ).id;
    termAId = await mkTerm(`${tag}-TA`, '2034-08-01', '2034-12-20');
    termBId = await mkTerm(`${tag}-TB`, '2035-01-05', '2035-05-30');

    courseId = (
      await prisma.course.create({
        data: {
          collegeId,
          departmentId,
          code: `${suffix}W3`.slice(0, 12),
          title: 'W3 Course',
          credits: 3,
        },
      })
    ).id;

    const mkStructure = async (name: string, termId: string, total: number) =>
      (
        await prisma.feeStructure.create({
          data: {
            collegeId,
            termId,
            name,
            totalAmount: total,
            components: { create: [{ label: 'Base', amount: total }] },
          },
        })
      ).id;
    structureId = await mkStructure(`${tag}-fee-A`, termAId, 10000);
    structureBId = await mkStructure(`${tag}-fee-B`, termBId, 20000);

    // A disposable student to own the exported invoices.
    const studentUser = await prisma.user.create({
      data: {
        collegeId,
        email: `${tag}-stu@campusos.dev`,
        passwordHash,
        role: 'STUDENT',
        status: 'ACTIVE',
        firstName: 'W3',
        lastName: 'Student',
        mustChangePassword: false,
        verificationStatus: 'VERIFIED',
      },
    });
    studentProfileId = (
      await prisma.studentProfile.create({
        data: {
          collegeId,
          userId: studentUser.id,
          departmentId,
          rollNo: `R${suffix}w3`.slice(0, 20),
          admissionNo: `A${suffix}w3`.slice(0, 20),
          batch: '2034',
        },
      })
    ).id;

    const mkInvoice = async (no: string, structure: string, amount: number) =>
      (
        await prisma.invoice.create({
          data: {
            collegeId,
            studentId: studentProfileId,
            structureId: structure,
            invoiceNo: no,
            amount,
            dueDate: new Date('2034-10-01'),
          },
        })
      ).id;
    invoiceAId = await mkInvoice(`${tag}-INV-A`, structureId, 10000);
    invoiceBId = await mkInvoice(`${tag}-INV-B`, structureBId, 20000);

    // Rival tenant with its own term + structure + invoice.
    const rival = await prisma.college.create({
      data: { name: 'W3 Rival', code: `RV25-${suffix}`.slice(0, 12) },
    });
    rivalCollegeId = rival.id;
    const rivalDept = await prisma.department.create({
      data: { collegeId: rival.id, code: `R25-${suffix}`.slice(0, 10), name: 'RD' },
    });
    const rivalYear = await prisma.academicYear.create({
      data: {
        collegeId: rival.id,
        label: `${tag}-RAY`,
        startsOn: new Date('2034-08-01'),
        endsOn: new Date('2035-06-30'),
      },
    });
    rivalTermId = (
      await prisma.term.create({
        data: {
          collegeId: rival.id,
          academicYearId: rivalYear.id,
          label: `${tag}-RT`,
          startsOn: new Date('2034-08-01'),
          endsOn: new Date('2034-12-20'),
          status: 'ACTIVE',
        },
      })
    ).id;
    rivalStructureId = (
      await prisma.feeStructure.create({
        data: {
          collegeId: rival.id,
          termId: rivalTermId,
          name: `${tag}-rival-fee`,
          totalAmount: 777,
          components: { create: [{ label: 'RivalBase', amount: 777 }] },
        },
      })
    ).id;
    const rivalStudentUser = await prisma.user.create({
      data: {
        collegeId: rival.id,
        email: `${tag}-rstu@rival.dev`,
        passwordHash,
        role: 'STUDENT',
        status: 'ACTIVE',
        firstName: 'Rival',
        lastName: 'Student',
        mustChangePassword: false,
        verificationStatus: 'VERIFIED',
      },
    });
    const rivalProfile = await prisma.studentProfile.create({
      data: {
        collegeId: rival.id,
        userId: rivalStudentUser.id,
        departmentId: rivalDept.id,
        rollNo: `RR${suffix}`.slice(0, 20),
        admissionNo: `RA${suffix}`.slice(0, 20),
        batch: '2034',
      },
    });
    await prisma.invoice.create({
      data: {
        collegeId: rival.id,
        studentId: rivalProfile.id,
        structureId: rivalStructureId,
        invoiceNo: `${tag}-RINV`,
        amount: 777,
        dueDate: new Date('2034-10-01'),
      },
    });

    adminToken = await login('admin@campusos.dev');
    accountantToken = await login('accountant@campusos.dev');
    teacherToken = await login('teacher@campusos.dev');
    studentToken = await login('student@campusos.dev');
  });

  afterAll(async () => {
    // Restore the demo college's grade bands EXACTLY as snapshotted.
    await prisma.gradeBand.deleteMany({ where: { collegeId } });
    for (const band of bandSnapshot) {
      await prisma.gradeBand.create({
        data: {
          collegeId,
          label: band.label,
          minPercent: band.minPercent,
          maxPercent: band.maxPercent,
          gradePoint: band.gradePoint,
          sortOrder: band.sortOrder,
        },
      });
    }

    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { collegeId: rivalCollegeId },
          { action: 'fees.structure_updated', targetId: { in: [structureId, structureBId] } },
          { action: 'exports.generated', createdAt: { gte: new Date(Date.now() - 3600_000) } },
        ],
      },
    });
    await prisma.payment.deleteMany({
      where: { invoiceId: { in: [invoiceAId, invoiceBId] } },
    });
    await prisma.invoice.deleteMany({
      where: {
        OR: [{ id: { in: [invoiceAId, invoiceBId] } }, { collegeId: rivalCollegeId }],
      },
    });
    await prisma.feeComponent.deleteMany({
      where: { structureId: { in: [structureId, structureBId, rivalStructureId] } },
    });
    await prisma.feeStructure.deleteMany({
      where: { id: { in: [structureId, structureBId, rivalStructureId] } },
    });
    await prisma.studentProfile.deleteMany({
      where: { user: { email: { startsWith: tag } } },
    });
    await prisma.term.deleteMany({
      where: { OR: [{ academicYearId: yearId }, { collegeId: rivalCollegeId }] },
    });
    await prisma.academicYear.deleteMany({
      where: { OR: [{ id: yearId }, { collegeId: rivalCollegeId }] },
    });
    await prisma.course.deleteMany({ where: { id: courseId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: tag } } });
    await prisma.department.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.auditLog.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.college.deleteMany({ where: { id: rivalCollegeId } });
    await app.close();
  });

  // ════════════════════════ D-4 ════════════════════════

  describe('D-4 — fee-structure write consistency', () => {
    it('A. sequential updates keep totalAmount == SUM(components)', async () => {
      for (const components of [
        [{ label: 'Tuition', amount: 15000 }],
        [
          { label: 'Tuition', amount: 12000 },
          { label: 'Lab', amount: 3500 },
        ],
        [
          { label: 'Tuition', amount: 9000 },
          { label: 'Lab', amount: 2000 },
          { label: 'Library', amount: 1000 },
        ],
      ]) {
        const res = await http
          .patch(`/api/v1/fees/structures/${structureId}`)
          .set(auth(adminToken))
          .send({ components });
        expect(res.status).toBe(200);
        const state = await assertTotalMatchesComponents(structureId);
        expect(state.components).toHaveLength(components.length);
      }
    });

    it('B. concurrent updates to the SAME structure never commit an inconsistent state', async () => {
      // Each writer proposes a distinct, internally consistent component
      // set. Whichever wins, the committed total must equal the committed
      // component sum and must be exactly ONE writer's proposal.
      const proposals = [
        [{ label: 'P0', amount: 1000 }],
        [
          { label: 'P1a', amount: 2000 },
          { label: 'P1b', amount: 250 },
        ],
        [{ label: 'P2', amount: 3000 }],
        [
          { label: 'P3a', amount: 4000 },
          { label: 'P3b', amount: 400 },
          { label: 'P3c', amount: 40 },
        ],
        [{ label: 'P4', amount: 5000 }],
        [{ label: 'P5', amount: 6000 }],
      ];
      const expectedTotals = proposals.map((p) =>
        p.reduce((s, c) => s + c.amount, 0),
      );

      // Several rounds — interleaving is probabilistic, so repeat.
      for (let round = 0; round < 4; round += 1) {
        const results = await Promise.all(
          proposals.map((components) =>
            http
              .patch(`/api/v1/fees/structures/${structureId}`)
              .set(auth(adminToken))
              .send({ components }),
          ),
        );
        expect(results.some((r) => r.status === 200)).toBe(true);

        const state = await assertTotalMatchesComponents(structureId);
        // the surviving state is exactly one writer's proposal, not a blend
        expect(expectedTotals).toContain(state.total);
        const labels = state.components.map((c) => c.label).sort();
        const matching = proposals.filter(
          (p) =>
            JSON.stringify(p.map((c) => c.label).sort()) === JSON.stringify(labels),
        );
        expect(matching).toHaveLength(1);
        expect(state.total).toBe(matching[0].reduce((s, c) => s + c.amount, 0));
      }
    });

    it('C. each committed concurrent mutation has exactly one truthful audit record', async () => {
      const before = await prisma.auditLog.count({
        where: { action: 'fees.structure_updated', targetId: structureId },
      });
      const proposals = [1100, 2200, 3300, 4400, 5500, 6600];
      const results = await Promise.all(
        proposals.map((amount) =>
          http
            .patch(`/api/v1/fees/structures/${structureId}`)
            .set(auth(adminToken))
            .send({ components: [{ label: 'Solo', amount }] }),
        ),
      );
      const succeeded = results.filter((r) => r.status === 200).length;
      const rows = await prisma.auditLog.findMany({
        where: { action: 'fees.structure_updated', targetId: structureId },
        orderBy: { createdAt: 'desc' },
      });
      // exactly one per committed mutation — no duplicates, no phantoms
      expect(rows.length - before).toBe(succeeded);

      for (const row of rows.slice(0, succeeded)) {
        const meta = row.metadata as Record<string, unknown>;
        expect(row.actorId).toBe(adminUserId); // server-derived
        expect(row.collegeId).toBe(collegeId); // server-derived
        expect(meta.termId).toBe(termAId);
        expect(meta.componentsReplaced).toBe(true);
        // Under the row lock the recorded after-state is now exact:
        // one component, and a total drawn from the proposals.
        expect(meta.componentCountAfter).toBe(1);
        expect(proposals.map(String)).toContain(String(meta.totalAmountAfter));
      }
      // final committed state is still self-consistent
      await assertTotalMatchesComponents(structureId);
    });

    it('D. concurrent writes in different tenants do not cross-contaminate', async () => {
      const results = await Promise.all([
        ...Array.from({ length: 3 }, (_, i) =>
          http
            .patch(`/api/v1/fees/structures/${structureId}`)
            .set(auth(adminToken))
            .send({ components: [{ label: 'MineA', amount: 7000 + i }] }),
        ),
        ...Array.from({ length: 3 }, (_, i) =>
          http
            .patch(`/api/v1/fees/structures/${structureBId}`)
            .set(auth(adminToken))
            .send({ components: [{ label: 'MineB', amount: 8000 + i }] }),
        ),
        // rival structure is not reachable at all
        http
          .patch(`/api/v1/fees/structures/${rivalStructureId}`)
          .set(auth(adminToken))
          .send({ components: [{ label: 'Hostile', amount: 1 }] }),
      ]);
      expect(results[6].status).toBe(404);

      const a = await assertTotalMatchesComponents(structureId);
      const b = await assertTotalMatchesComponents(structureBId);
      expect(a.components.every((c) => c.label === 'MineA')).toBe(true);
      expect(b.components.every((c) => c.label === 'MineB')).toBe(true);

      // rival untouched, and no audit landed in the rival tenant
      const rival = await prisma.feeStructure.findUniqueOrThrow({
        where: { id: rivalStructureId },
        include: { components: true },
      });
      expect(Number(rival.totalAmount)).toBe(777);
      expect(rival.components.map((c) => c.label)).toEqual(['RivalBase']);
      expect(await prisma.auditLog.count({ where: { collegeId: rivalCollegeId } })).toBe(0);
    });

    it('E. injected failure rolls back the component rewrite AND the audit', async () => {
      const auditService = app.get(AuditService);
      const before = await prisma.feeStructure.findUniqueOrThrow({
        where: { id: structureId },
        include: { components: true },
      });
      const auditBefore = await prisma.auditLog.count();

      const spy = jest
        .spyOn(auditService, 'logAtomic')
        .mockRejectedValueOnce(new Error('audit store unavailable'));
      try {
        const res = await http
          .patch(`/api/v1/fees/structures/${structureId}`)
          .set(auth(adminToken))
          .send({ components: [{ label: 'Ghost', amount: 99999 }] });
        expect(res.status).toBeGreaterThanOrEqual(500);
      } finally {
        spy.mockRestore();
      }

      const after = await prisma.feeStructure.findUniqueOrThrow({
        where: { id: structureId },
        include: { components: true },
      });
      expect(Number(after.totalAmount)).toBe(Number(before.totalAmount));
      expect(after.components.map((c) => c.label).sort()).toEqual(
        before.components.map((c) => c.label).sort(),
      );
      expect(await prisma.auditLog.count()).toBe(auditBefore);
      await assertTotalMatchesComponents(structureId);
    });

    it('F. authorization and tenancy on the locked path are unchanged', async () => {
      for (const token of [teacherToken, studentToken]) {
        const res = await http
          .patch(`/api/v1/fees/structures/${structureId}`)
          .set(auth(token))
          .send({ components: [{ label: 'Nope', amount: 1 }] });
        expect(res.status).toBe(403);
      }
      const anon = await http
        .patch(`/api/v1/fees/structures/${structureId}`)
        .send({ components: [{ label: 'Nope', amount: 1 }] });
      expect(anon.status).toBe(401);
      // accountant holds fees.manage and still works
      const ok = await http
        .patch(`/api/v1/fees/structures/${structureId}`)
        .set(auth(accountantToken))
        .send({ components: [{ label: 'Final', amount: 10000 }] });
      expect(ok.status).toBe(200);
      await assertTotalMatchesComponents(structureId);
    });
  });

  // ════════════════════════ D-1 ════════════════════════

  describe('D-1 — fees CSV termId filter', () => {
    const parse = (csv: string) => {
      // toCsv emits CRLF with a trailing terminator (common/csv.ts).
      const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
      return { header: lines[0], rows: lines.slice(1) };
    };

    it('A. no-filter export is unchanged and includes both terms', async () => {
      const res = await http.get('/api/v1/exports/fees.csv').set(auth(adminToken));
      expect(res.status).toBe(200);
      const { header, rows } = parse(res.text);
      expect(header).toBe(
        'invoiceNo,student,rollNo,admissionNo,amount,paid,status,dueDate',
      );
      expect(rows.some((r) => r.includes(`${tag}-INV-A`))).toBe(true);
      expect(rows.some((r) => r.includes(`${tag}-INV-B`))).toBe(true);
    });

    it('B. a valid termId returns 200 and only that term\u2019s invoices', async () => {
      const res = await http
        .get(`/api/v1/exports/fees.csv?termId=${termAId}`)
        .set(auth(adminToken));
      expect(res.status).toBe(200); // was 500 before the fix
      const { header, rows } = parse(res.text);
      expect(header).toBe(
        'invoiceNo,student,rollNo,admissionNo,amount,paid,status,dueDate',
      );
      expect(rows.some((r) => r.includes(`${tag}-INV-A`))).toBe(true);
      expect(rows.some((r) => r.includes(`${tag}-INV-B`))).toBe(false);
    });

    it('C. a different valid termId excludes the other term', async () => {
      const res = await http
        .get(`/api/v1/exports/fees.csv?termId=${termBId}`)
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      const { rows } = parse(res.text);
      expect(rows.some((r) => r.includes(`${tag}-INV-B`))).toBe(true);
      expect(rows.some((r) => r.includes(`${tag}-INV-A`))).toBe(false);
    });

    it('D. an unknown termId is a deterministic empty export, never a 500', async () => {
      const res = await http
        .get('/api/v1/exports/fees.csv?termId=ckdoesnotexist0000000000')
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      const { header, rows } = parse(res.text);
      expect(header).toBe(
        'invoiceNo,student,rollNo,admissionNo,amount,paid,status,dueDate',
      );
      expect(rows.filter((r) => r.trim().length > 0)).toHaveLength(0);
    });

    it('E. a cross-college termId cannot surface the rival tenant\u2019s invoices', async () => {
      const res = await http
        .get(`/api/v1/exports/fees.csv?termId=${rivalTermId}`)
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      const { rows } = parse(res.text);
      // the rival term exists, but not in this tenant → empty, no leak
      expect(rows.filter((r) => r.trim().length > 0)).toHaveLength(0);
      expect(res.text).not.toContain(`${tag}-RINV`);
      expect(res.text).not.toContain('777');
    });

    it('F. status filter still works and composes with termId', async () => {
      const both = await http
        .get(`/api/v1/exports/fees.csv?termId=${termAId}&status=PENDING`)
        .set(auth(adminToken));
      expect(both.status).toBe(200);
      expect(both.text).toContain(`${tag}-INV-A`);
      expect(both.text).not.toContain(`${tag}-INV-B`);

      const none = await http
        .get(`/api/v1/exports/fees.csv?termId=${termAId}&status=CANCELLED`)
        .set(auth(adminToken));
      expect(none.status).toBe(200);
      expect(none.text).not.toContain(`${tag}-INV-A`);
    });

    it('G. authorization is unchanged — non fees.read-ALL principals denied', async () => {
      for (const token of [teacherToken, studentToken]) {
        const res = await http
          .get(`/api/v1/exports/fees.csv?termId=${termAId}`)
          .set(auth(token));
        expect(res.status).toBe(403);
      }
      const anon = await http.get(`/api/v1/exports/fees.csv?termId=${termAId}`);
      expect(anon.status).toBe(401);
      // accountant holds fees.read ALL
      const ok = await http
        .get(`/api/v1/exports/fees.csv?termId=${termAId}`)
        .set(auth(accountantToken));
      expect(ok.status).toBe(200);
    });

    it('a client-supplied collegeId cannot widen the export', async () => {
      const res = await http
        .get(
          `/api/v1/exports/fees.csv?termId=${rivalTermId}&collegeId=${rivalCollegeId}`,
        )
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.text).not.toContain(`${tag}-RINV`);
    });
  });

  // ════════════════════════ D-2 ════════════════════════

  describe('D-2 — grade-band gradePoint preservation', () => {
    const bands = [
      { label: 'A+', minPercent: 90, maxPercent: 100 },
      { label: 'A', minPercent: 80, maxPercent: 89.99 },
      { label: 'B', minPercent: 70, maxPercent: 79.99 },
      { label: 'F', minPercent: 0, maxPercent: 69.99 },
    ];

    /** Configure a GPA scale directly — the only way, since it is not client-settable. */
    async function seedGradePoints(points: Record<string, string>) {
      const res = await http
        .put('/api/v1/grade-bands')
        .set(auth(adminToken))
        .send({ bands });
      expect(res.status).toBe(200);
      for (const [label, gradePoint] of Object.entries(points)) {
        await prisma.gradeBand.updateMany({
          where: { collegeId, label },
          data: { gradePoint },
        });
      }
    }

    const pointsByLabel = async () => {
      const rows = await prisma.gradeBand.findMany({
        where: { collegeId },
        orderBy: { sortOrder: 'asc' },
      });
      return Object.fromEntries(
        rows.map((r) => [r.label, r.gradePoint === null ? null : r.gradePoint.toString()]),
      );
    };

    it('A. configured gradePoint survives a grade-band update', async () => {
      await seedGradePoints({ 'A+': '4', A: '3.7', B: '3', F: '0' });
      expect(await pointsByLabel()).toEqual({
        'A+': '4',
        A: '3.7',
        B: '3',
        F: '0',
      });

      // an ordinary update that does not mean to touch the GPA scale
      const res = await http
        .put('/api/v1/grade-bands')
        .set(auth(adminToken))
        .send({ bands })
        .expect(200);
      expect(res.body.data).toHaveLength(4);
      // BEFORE the fix every value here was erased to null
      expect(await pointsByLabel()).toEqual({
        'A+': '4',
        A: '3.7',
        B: '3',
        F: '0',
      });
    });

    it('B. changing unrelated fields (percent boundaries) does not erase gradePoint', async () => {
      const widened = [
        { label: 'A+', minPercent: 92, maxPercent: 100 },
        { label: 'A', minPercent: 82, maxPercent: 91.99 },
        { label: 'B', minPercent: 72, maxPercent: 81.99 },
        { label: 'F', minPercent: 0, maxPercent: 71.99 },
      ];
      const res = await http
        .put('/api/v1/grade-bands')
        .set(auth(adminToken))
        .send({ bands: widened });
      expect(res.status).toBe(200);
      expect(await pointsByLabel()).toEqual({
        'A+': '4',
        A: '3.7',
        B: '3',
        F: '0',
      });
      const rows = await prisma.gradeBand.findMany({
        where: { collegeId },
        orderBy: { sortOrder: 'asc' },
      });
      expect(rows.map((r) => Number(r.minPercent)).sort((a, b) => a - b)).toEqual([
        0, 72, 82, 92,
      ]);
    });

    it('C. a NEW band label gets no invented grade point, and removed labels drop out', async () => {
      const replaced = [
        { label: 'A+', minPercent: 90, maxPercent: 100 },
        { label: 'A', minPercent: 80, maxPercent: 89.99 },
        { label: 'C', minPercent: 60, maxPercent: 79.99 }, // new label
        { label: 'F', minPercent: 0, maxPercent: 59.99 },
      ];
      const res = await http
        .put('/api/v1/grade-bands')
        .set(auth(adminToken))
        .send({ bands: replaced });
      expect(res.status).toBe(200);
      const points = await pointsByLabel();
      expect(points['A+']).toBe('4');
      expect(points.A).toBe('3.7');
      expect(points.C).toBeNull(); // no invented GPA policy
      expect(points.F).toBe('0');
      expect(points.B).toBeUndefined(); // dropped band is gone
    });

    it('D. gradePoint is NOT client-settable — a hostile body cannot inject it', async () => {
      const res = await http
        .put('/api/v1/grade-bands')
        .set(auth(adminToken))
        .send({
          bands: [
            { label: 'A+', minPercent: 90, maxPercent: 100, gradePoint: 99 },
            { label: 'A', minPercent: 80, maxPercent: 89.99, gradePoint: -5 },
            { label: 'C', minPercent: 60, maxPercent: 79.99, gradePoint: 4 },
            { label: 'F', minPercent: 0, maxPercent: 59.99, gradePoint: 'abc' },
          ],
        });
      expect(res.status).toBe(200);
      const points = await pointsByLabel();
      // preserved server-side values, NOT the injected ones
      expect(points['A+']).toBe('4');
      expect(points.A).toBe('3.7');
      expect(points.C).toBeNull();
      expect(points.F).toBe('0');
      // and the read contract still does not expose gradePoint
      expect(Object.keys(res.body.data[0]).sort()).toEqual([
        'id',
        'label',
        'maxPercent',
        'minPercent',
        'sortOrder',
      ]);
    });

    it('validation conventions are unchanged (overlap, count, range)', async () => {
      const overlap = await http
        .put('/api/v1/grade-bands')
        .set(auth(adminToken))
        .send({
          bands: [
            { label: 'A', minPercent: 50, maxPercent: 100 },
            { label: 'B', minPercent: 40, maxPercent: 60 },
          ],
        });
      expect(overlap.status).toBe(400);
      expect(overlap.body.error.code).toBe('BANDS_OVERLAP');

      const tooFew = await http
        .put('/api/v1/grade-bands')
        .set(auth(adminToken))
        .send({ bands: [{ label: 'A', minPercent: 0, maxPercent: 100 }] });
      expect(tooFew.status).toBe(400);

      const outOfRange = await http
        .put('/api/v1/grade-bands')
        .set(auth(adminToken))
        .send({
          bands: [
            { label: 'A', minPercent: 0, maxPercent: 50 },
            { label: 'B', minPercent: 60, maxPercent: 500 },
          ],
        });
      expect(outOfRange.status).toBe(400);

      // a rejected update erases nothing
      const points = await pointsByLabel();
      expect(points['A+']).toBe('4');
    });

    it('E/F. authorization and tenancy on grade bands are unchanged', async () => {
      for (const token of [teacherToken, studentToken]) {
        const res = await http
          .put('/api/v1/grade-bands')
          .set(auth(token))
          .send({ bands });
        expect(res.status).toBe(403);
      }
      expect((await http.put('/api/v1/grade-bands').send({ bands })).status).toBe(
        401,
      );
      // the rival college's bands are untouched by our writes
      expect(await prisma.gradeBand.count({ where: { collegeId: rivalCollegeId } })).toBe(
        0,
      );
      // still preserved after the denied attempts
      expect((await pointsByLabel())['A+']).toBe('4');
    });

    it('G. GPA/result semantics unchanged: a fully configured scale computes, a gap yields null', async () => {
      // This mirrors the M18 O-4 rule and must not be altered by D-2.
      await seedGradePoints({ 'A+': '4', A: '3.7', B: '3', F: '0' });
      const configured = await prisma.gradeBand.findMany({ where: { collegeId } });
      expect(configured.every((b) => b.gradePoint !== null)).toBe(true);

      // introduce a GPA gap by adding a band with no grade point.
      // M24-W3b (N-11): `maxPercent` corrected 69.98 -> 69.99 so the band
      // set is contiguous under the new 0-100 coverage invariant. 69.98
      // left the percentage 69.99 covered by no band, which the validator
      // now (correctly) rejects. The correction is incidental to this
      // test's purpose — it asserts a NEW label receives no invented
      // gradePoint while existing points survive — and every assertion
      // below is unchanged.
      const withGap = [
        ...bands,
        { label: 'D', minPercent: 60, maxPercent: 69.99 },
      ].map((b) => (b.label === 'F' ? { ...b, maxPercent: 59.99 } : b));
      const res = await http
        .put('/api/v1/grade-bands')
        .set(auth(adminToken))
        .send({ bands: withGap });
      expect(res.status).toBe(200);
      const points = await pointsByLabel();
      expect(points.D).toBeNull(); // gap preserved honestly
      expect(points['A+']).toBe('4'); // others still intact
    });

    it('H. audit behaviour is correct: exactly one atomic event per successful update', async () => {
      const before = await prisma.auditLog.count({
        where: { action: 'grade_bands.updated', collegeId },
      });
      const ok = await http
        .put('/api/v1/grade-bands')
        .set(auth(adminToken))
        .send({ bands });
      expect(ok.status).toBe(200);
      const rows = await prisma.auditLog.findMany({
        where: { action: 'grade_bands.updated', collegeId },
        orderBy: { createdAt: 'desc' },
      });
      expect(rows.length - before).toBe(1);
      expect(rows[0].actorId).toBe(adminUserId); // server-derived
      expect(rows[0].collegeId).toBe(collegeId); // server-derived

      // a rejected update writes no audit record
      const auditBefore = await prisma.auditLog.count();
      const bad = await http
        .put('/api/v1/grade-bands')
        .set(auth(adminToken))
        .send({
          bands: [
            { label: 'X', minPercent: 0, maxPercent: 80 },
            { label: 'Y', minPercent: 50, maxPercent: 100 },
          ],
        });
      expect(bad.status).toBe(400);
      expect(await prisma.auditLog.count()).toBe(auditBefore);
    });
  });

  // ════════════════════════ cross-cutting ════════════════════════

  describe('cross-cutting invariants', () => {
    it('S-1 (W1) remains closed', async () => {
      const unassigned = await prisma.studentProfile.findFirstOrThrow({
        where: {
          collegeId,
          enrollments: {
            none: {
              status: 'ACTIVE',
              section: {
                teachingAssignments: {
                  some: { teacher: { user: { email: 'teacher@campusos.dev' } } },
                },
              },
            },
          },
        },
      });
      const res = await http
        .get(`/api/v1/results/transcript?studentId=${unassigned.id}`)
        .set(auth(teacherToken));
      expect(res.status).toBe(404);
      expect(res.body.data).toBeUndefined();
    });

    it('no role-name conditionals or client-trusted tenancy in the touched services', async () => {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      for (const file of [
        'fees/fees.service.ts',
        'exams/exams.service.ts',
        'exports/exports.module.ts',
      ]) {
        const src = readFileSync(join(__dirname, '..', 'src', file), 'utf8');
        expect(src).not.toContain('user.role ===');
        expect(src).not.toContain('input.collegeId');
        expect(src).not.toContain('query.collegeId');
        expect(src).not.toContain('input.actorId');
      }
    });

    it('financial immutability is untouched: invoice amounts are snapshots', async () => {
      // structure totals changed a lot above; the invoice keeps its snapshot
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceAId } });
      expect(Number(invoice.amount)).toBe(10000);
    });
  });
});
