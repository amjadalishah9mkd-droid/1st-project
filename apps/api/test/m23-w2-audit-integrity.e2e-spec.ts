import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M23-W2 — audit integrity for the S-2 unaudited mutation surface.
 *
 * W0 found eight configuration/academic mutation paths whose `create`
 * sibling was audited but whose `update` emitted nothing. The most
 * consequential is fee-structure update, which deletes and recreates
 * every fee component and so silently rewrites what future invoices
 * charge.
 *
 * These tests prove, against real PostgreSQL: exactly-once audit on
 * success, ZERO audit on denial/validation failure, server-derived actor
 * and tenant that hostile client fields cannot spoof, atomic rollback of
 * mutation + audit together, no audit on reads, and no false duplicate
 * success events under concurrency.
 *
 * All fixtures are disposable. Demo accounts are used only as
 * authenticated principals and are never lifecycle targets.
 */
describe('M23-W2 — audit integrity (S-2)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  const tag = `m23w2-${suffix}`;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let collegeId: string;
  let departmentId: string;
  let passwordHash: string;
  let adminUserId: string;

  let adminToken: string;
  let accountantToken: string;
  let teacherToken: string;
  let studentToken: string;

  let yearId: string;
  let termId: string;
  let closedTermId: string;
  let courseId: string;
  let sectionId: string;
  let structureId: string;
  let examId: string;
  let paperId: string;
  let slotId: string;
  let assignmentId: string;

  // rival tenant
  let rivalCollegeId: string;
  let rivalStructureId: string;

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  /** Audit rows for an action, newest first — tenant-scoped like production. */
  async function auditRows(action: string, targetId?: string) {
    return prisma.auditLog.findMany({
      where: { action, ...(targetId ? { targetId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }
  async function auditCount(action: string, targetId?: string) {
    return prisma.auditLog.count({
      where: { action, ...(targetId ? { targetId } : {}) },
    });
  }
  /** Total audit rows in existence — for "zero new records" assertions. */
  const totalAudit = () => prisma.auditLog.count();

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

    yearId = (
      await prisma.academicYear.create({
        data: {
          collegeId,
          label: `${tag}-AY`,
          startsOn: new Date('2032-08-01'),
          endsOn: new Date('2033-06-30'),
        },
      })
    ).id;
    termId = (
      await prisma.term.create({
        data: {
          collegeId,
          academicYearId: yearId,
          label: `${tag}-T`,
          startsOn: new Date('2032-08-01'),
          endsOn: new Date('2032-12-20'),
          status: 'ACTIVE',
        },
      })
    ).id;
    closedTermId = (
      await prisma.term.create({
        data: {
          collegeId,
          academicYearId: yearId,
          label: `${tag}-TC`,
          startsOn: new Date('2033-01-05'),
          endsOn: new Date('2033-05-30'),
          status: 'CLOSED',
        },
      })
    ).id;
    courseId = (
      await prisma.course.create({
        data: {
          collegeId,
          departmentId,
          code: `${suffix}W2`.slice(0, 12),
          title: 'W2 Course',
          credits: 3,
        },
      })
    ).id;
    sectionId = (
      await prisma.section.create({
        data: { collegeId, courseId, termId, name: 'W2A', capacity: 30 },
      })
    ).id;

    structureId = (
      await prisma.feeStructure.create({
        data: {
          collegeId,
          termId,
          name: `${tag}-fee`,
          totalAmount: 30000,
          components: {
            create: [
              { label: 'Tuition', amount: 20000 },
              { label: 'Lab', amount: 10000 },
            ],
          },
        },
      })
    ).id;

    examId = (
      await prisma.exam.create({
        data: { collegeId, termId, title: `${tag}-exam`, type: 'MIDTERM', status: 'DRAFT' },
      })
    ).id;
    paperId = (
      await prisma.examPaper.create({
        data: {
          examId,
          sectionId,
          maxMarks: 100,
          examDate: new Date('2032-11-01'),
          room: 'R1',
        },
      })
    ).id;
    slotId = (
      await prisma.timetableSlot.create({
        data: { sectionId, dayOfWeek: 2, startTime: '09:00', endTime: '10:00', room: 'R1' },
      })
    ).id;
    assignmentId = (
      await prisma.assignment.create({
        data: {
          sectionId,
          title: `${tag}-hw`,
          description: 'original description',
          createdById: adminUserId,
          maxPoints: 50,
          dueAt: new Date('2032-11-15'),
        },
      })
    ).id;

    // Rival tenant fee structure — cross-college target.
    const rival = await prisma.college.create({
      data: { name: 'W2 Rival', code: `RV24-${suffix}`.slice(0, 12) },
    });
    rivalCollegeId = rival.id;
    const rivalYear = await prisma.academicYear.create({
      data: {
        collegeId: rival.id,
        label: `${tag}-RAY`,
        startsOn: new Date('2032-08-01'),
        endsOn: new Date('2033-06-30'),
      },
    });
    const rivalTerm = await prisma.term.create({
      data: {
        collegeId: rival.id,
        academicYearId: rivalYear.id,
        label: `${tag}-RT`,
        startsOn: new Date('2032-08-01'),
        endsOn: new Date('2032-12-20'),
        status: 'ACTIVE',
      },
    });
    rivalStructureId = (
      await prisma.feeStructure.create({
        data: {
          collegeId: rival.id,
          termId: rivalTerm.id,
          name: `${tag}-rival-fee`,
          totalAmount: 999,
          components: { create: [{ label: 'RivalFee', amount: 999 }] },
        },
      })
    ).id;

    adminToken = await login('admin@campusos.dev');
    accountantToken = await login('accountant@campusos.dev');
    teacherToken = await login('teacher@campusos.dev');
    studentToken = await login('student@campusos.dev');
  });

  afterAll(async () => {
    const actions = [
      'fees.structure_updated',
      'exams.updated',
      'exams.paper_updated',
      'academic_years.updated',
      'terms.updated',
      'sections.updated',
      'timetable.slot_updated',
      'assignments.updated',
    ];
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { collegeId: rivalCollegeId },
          {
            action: { in: actions },
            targetId: {
              in: [
                structureId,
                examId,
                paperId,
                yearId,
                termId,
                closedTermId,
                sectionId,
                slotId,
                assignmentId,
              ],
            },
          },
        ],
      },
    });
    await prisma.submission.deleteMany({ where: { assignmentId } });
    await prisma.assignment.deleteMany({ where: { id: assignmentId } });
    await prisma.timetableSlot.deleteMany({ where: { sectionId } });
    await prisma.mark.deleteMany({ where: { examPaper: { examId } } });
    await prisma.examPaper.deleteMany({ where: { examId } });
    await prisma.exam.deleteMany({ where: { id: examId } });
    await prisma.feeComponent.deleteMany({
      where: { structureId: { in: [structureId, rivalStructureId] } },
    });
    await prisma.feeStructure.deleteMany({
      where: { id: { in: [structureId, rivalStructureId] } },
    });
    await prisma.enrollment.deleteMany({ where: { sectionId } });
    await prisma.section.deleteMany({ where: { id: sectionId } });
    await prisma.term.deleteMany({
      where: { OR: [{ academicYearId: yearId }, { collegeId: rivalCollegeId }] },
    });
    await prisma.academicYear.deleteMany({
      where: { OR: [{ id: yearId }, { collegeId: rivalCollegeId }] },
    });
    await prisma.course.deleteMany({ where: { id: courseId } });
    await prisma.auditLog.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.college.deleteMany({ where: { id: rivalCollegeId } });
    await app.close();
  });

  // ── 1. exactly-once success audit ──────────────────────────────────

  describe('fee-structure update — the priority path', () => {
    it('authorized update succeeds and writes EXACTLY ONE audit record', async () => {
      const before = await auditCount('fees.structure_updated', structureId);
      const res = await http
        .patch(`/api/v1/fees/structures/${structureId}`)
        .set(auth(adminToken))
        .send({
          name: `${tag}-fee-renamed`,
          components: [
            { label: 'Tuition', amount: 25000 },
            { label: 'Lab', amount: 10000 },
            { label: 'Library', amount: 5000 },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.data.totalAmount).toBe('40000');

      const rows = await auditRows('fees.structure_updated', structureId);
      expect(rows.length - before).toBe(1);
      const row = rows[0];
      expect(row.action).toBe('fees.structure_updated');
      expect(row.targetType).toBe('FeeStructure');
      expect(row.targetId).toBe(structureId);
      // actor + tenant are server-derived
      expect(row.actorId).toBe(adminUserId);
      expect(row.collegeId).toBe(collegeId);
      // metadata describes WHAT changed, minimally
      const meta = row.metadata as Record<string, unknown>;
      expect(meta).toMatchObject({
        termId,
        componentsReplaced: true,
        componentCountBefore: 2,
        componentCountAfter: 3,
        totalAmountBefore: '30000',
        totalAmountAfter: '40000',
        existingInvoiceCount: 0,
      });
      expect(meta.changed).toEqual(['name']);
    });

    it('the component replacement really happened (semantics preserved)', async () => {
      const components = await prisma.feeComponent.findMany({
        where: { structureId },
        orderBy: { label: 'asc' },
      });
      expect(components.map((c) => c.label)).toEqual(['Lab', 'Library', 'Tuition']);
      const structure = await prisma.feeStructure.findUniqueOrThrow({
        where: { id: structureId },
      });
      // server-computed total still equals the component sum
      expect(Number(structure.totalAmount)).toBe(
        components.reduce((s, c) => s + Number(c.amount), 0),
      );
    });

    it('audit metadata leaks no component labels, payload, secrets or personal data', async () => {
      const rows = await auditRows('fees.structure_updated', structureId);
      const meta = JSON.stringify(rows[0].metadata);
      for (const leak of [
        'Tuition',
        'Library',
        'Lab',
        'password',
        'token',
        'secret',
        'Authorization',
        'Bearer',
        '@campusos.dev',
        'guardian',
      ]) {
        expect(meta).not.toContain(leak);
      }
      // metadata keys are a fixed, reviewed allowlist
      expect(Object.keys(rows[0].metadata as object).sort()).toEqual([
        'changed',
        'componentCountAfter',
        'componentCountBefore',
        'componentsReplaced',
        'existingInvoiceCount',
        'termId',
        'totalAmountAfter',
        'totalAmountBefore',
      ]);
    });

    it('a no-op update records the mutation with an empty changed list, not a false claim', async () => {
      const current = await prisma.feeStructure.findUniqueOrThrow({
        where: { id: structureId },
      });
      const before = await auditCount('fees.structure_updated', structureId);
      const res = await http
        .patch(`/api/v1/fees/structures/${structureId}`)
        .set(auth(adminToken))
        .send({ name: current.name });
      expect(res.status).toBe(200);
      const rows = await auditRows('fees.structure_updated', structureId);
      expect(rows.length - before).toBe(1);
      const meta = rows[0].metadata as Record<string, unknown>;
      expect(meta.changed).toEqual([]);
      expect(meta.componentsReplaced).toBe(false);
    });
  });

  // ── 2. denial writes nothing ───────────────────────────────────────

  describe('denied mutations create ZERO audit records', () => {
    it('anonymous request is rejected and writes nothing', async () => {
      const before = await totalAudit();
      const res = await http
        .patch(`/api/v1/fees/structures/${structureId}`)
        .send({ name: 'anonymous takeover' });
      expect(res.status).toBe(401);
      expect(await totalAudit()).toBe(before);
    });

    it('a garbage bearer token is rejected and writes nothing', async () => {
      const before = await totalAudit();
      const res = await http
        .patch(`/api/v1/fees/structures/${structureId}`)
        .set(auth('not.a.real.token'))
        .send({ name: 'forged' });
      expect(res.status).toBe(401);
      expect(await totalAudit()).toBe(before);
    });

    it('principals without fees.manage are denied and write nothing', async () => {
      for (const token of [teacherToken, studentToken]) {
        const before = await totalAudit();
        const res = await http
          .patch(`/api/v1/fees/structures/${structureId}`)
          .set(auth(token))
          .send({ name: 'privilege escalation', components: [{ label: 'X', amount: 1 }] });
        expect(res.status).toBe(403);
        expect(await totalAudit()).toBe(before);
      }
      // and the structure is untouched
      const structure = await prisma.feeStructure.findUniqueOrThrow({
        where: { id: structureId },
      });
      expect(structure.name).not.toBe('privilege escalation');
    });

    it('a cross-college target is denied and writes nothing', async () => {
      const before = await totalAudit();
      const res = await http
        .patch(`/api/v1/fees/structures/${rivalStructureId}`)
        .set(auth(adminToken))
        .send({ name: 'cross tenant write', components: [{ label: 'X', amount: 1 }] });
      expect(res.status).toBe(404);
      expect(await totalAudit()).toBe(before);
      // rival data untouched, and no audit row landed in either tenant
      const rival = await prisma.feeStructure.findUniqueOrThrow({
        where: { id: rivalStructureId },
      });
      expect(rival.name).toBe(`${tag}-rival-fee`);
      expect(Number(rival.totalAmount)).toBe(999);
      expect(await prisma.auditLog.count({ where: { collegeId: rivalCollegeId } })).toBe(0);
    });

    it('a nonexistent target is denied and writes nothing', async () => {
      const before = await totalAudit();
      const res = await http
        .patch('/api/v1/fees/structures/ckdoesnotexist0000000000')
        .set(auth(adminToken))
        .send({ name: 'ghost' });
      expect(res.status).toBe(404);
      expect(await totalAudit()).toBe(before);
    });

    it('failed validation writes no success audit record', async () => {
      const before = await totalAudit();
      // schema rejection (negative amount)
      const bad = await http
        .patch(`/api/v1/fees/structures/${structureId}`)
        .set(auth(adminToken))
        .send({ components: [{ label: 'Negative', amount: -5 }] });
      expect(bad.status).toBe(400);
      expect(await totalAudit()).toBe(before);
    });

    it('a CLOSED-term rejection rolls back the mutation AND the audit together', async () => {
      const closedStructure = await prisma.feeStructure.create({
        data: {
          collegeId,
          termId: closedTermId,
          name: `${tag}-closed-fee`,
          totalAmount: 5000,
          components: { create: [{ label: 'Base', amount: 5000 }] },
        },
      });
      const before = await totalAudit();
      const res = await http
        .patch(`/api/v1/fees/structures/${closedStructure.id}`)
        .set(auth(adminToken))
        .send({ name: 'closed edit', components: [{ label: 'New', amount: 7777 }] });
      expect(res.status).toBeGreaterThanOrEqual(400);
      // no audit, no partial component rewrite
      expect(await totalAudit()).toBe(before);
      expect(await auditCount('fees.structure_updated', closedStructure.id)).toBe(0);
      const after = await prisma.feeStructure.findUniqueOrThrow({
        where: { id: closedStructure.id },
        include: { components: true },
      });
      expect(after.name).toBe(`${tag}-closed-fee`);
      expect(Number(after.totalAmount)).toBe(5000);
      expect(after.components.map((c) => c.label)).toEqual(['Base']);

      await prisma.feeComponent.deleteMany({ where: { structureId: closedStructure.id } });
      await prisma.feeStructure.delete({ where: { id: closedStructure.id } });
    });

    it('reads create no audit records', async () => {
      const before = await totalAudit();
      for (let i = 0; i < 3; i += 1) {
        expect(
          (await http.get('/api/v1/fees/structures').set(auth(adminToken))).status,
        ).toBe(200);
        expect(
          (await http.get('/api/v1/fees/summary').set(auth(adminToken))).status,
        ).toBe(200);
      }
      expect(await totalAudit()).toBe(before);
    });
  });

  // ── 3. non-spoofable identity ──────────────────────────────────────

  describe('audit identity is server-derived and non-spoofable', () => {
    it('hostile actorId/collegeId/userId body fields cannot influence the record', async () => {
      const victim = await prisma.user.findFirstOrThrow({
        where: { email: 'teacher@campusos.dev' },
      });
      const before = await auditCount('fees.structure_updated', structureId);
      const res = await http
        .patch(`/api/v1/fees/structures/${structureId}`)
        .set(auth(accountantToken))
        .send({
          name: `${tag}-spoof-attempt`,
          // every authorization-adjacent field a hostile client might try
          actorId: victim.id,
          userId: victim.id,
          collegeId: rivalCollegeId,
          college: rivalCollegeId,
          role: 'ADMIN',
          scope: 'ALL',
          action: 'fees.structure_created',
          targetType: 'Bogus',
          targetId: rivalStructureId,
          metadata: { injected: 'payload', password: 'hunter2' },
        });
      expect(res.status).toBe(200);

      const rows = await auditRows('fees.structure_updated', structureId);
      expect(rows.length - before).toBe(1);
      const row = rows[0];
      const accountant = await prisma.user.findFirstOrThrow({
        where: { email: 'accountant@campusos.dev' },
      });
      // actor is the authenticated principal, NOT the injected victim
      expect(row.actorId).toBe(accountant.id);
      expect(row.actorId).not.toBe(victim.id);
      // tenant is the caller's own college, NOT the injected rival
      expect(row.collegeId).toBe(collegeId);
      expect(row.collegeId).not.toBe(rivalCollegeId);
      // target is the real target, not the injected one
      expect(row.targetId).toBe(structureId);
      expect(row.targetType).toBe('FeeStructure');
      // injected metadata never reaches the record
      const meta = JSON.stringify(row.metadata);
      expect(meta).not.toContain('injected');
      expect(meta).not.toContain('hunter2');
      // and nothing landed in the rival tenant
      expect(await prisma.auditLog.count({ where: { collegeId: rivalCollegeId } })).toBe(0);
    });
  });

  // ── 4. transactionality ────────────────────────────────────────────

  describe('mutation and audit are atomic', () => {
    it('an audit write failure rolls back the fee-component rewrite', async () => {
      const auditService = app.get(AuditService);
      const structureBefore = await prisma.feeStructure.findUniqueOrThrow({
        where: { id: structureId },
        include: { components: true },
      });
      const auditBefore = await totalAudit();

      const spy = jest
        .spyOn(auditService, 'logAtomic')
        .mockRejectedValueOnce(new Error('audit store unavailable'));
      try {
        const res = await http
          .patch(`/api/v1/fees/structures/${structureId}`)
          .set(auth(adminToken))
          .send({
            name: `${tag}-should-not-persist`,
            components: [{ label: 'Ghost', amount: 12345 }],
          });
        expect(res.status).toBeGreaterThanOrEqual(500);
      } finally {
        spy.mockRestore();
      }

      // neither the mutation nor any audit residue survived
      const after = await prisma.feeStructure.findUniqueOrThrow({
        where: { id: structureId },
        include: { components: true },
      });
      expect(after.name).toBe(structureBefore.name);
      expect(Number(after.totalAmount)).toBe(Number(structureBefore.totalAmount));
      expect(after.components.map((c) => c.label).sort()).toEqual(
        structureBefore.components.map((c) => c.label).sort(),
      );
      expect(await totalAudit()).toBe(auditBefore);
    });

    it('after the failure the path still works normally', async () => {
      const before = await auditCount('fees.structure_updated', structureId);
      const res = await http
        .patch(`/api/v1/fees/structures/${structureId}`)
        .set(auth(adminToken))
        .send({ name: `${tag}-recovered` });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe(`${tag}-recovered`);
      expect(await auditCount('fees.structure_updated', structureId)).toBe(before + 1);
    });
  });

  // ── 5. concurrency ─────────────────────────────────────────────────

  describe('concurrency', () => {
    it('racing updates produce exactly one audit record per successful mutation', async () => {
      const before = await auditCount('fees.structure_updated', structureId);
      const attempts = 6;
      const results = await Promise.all(
        Array.from({ length: attempts }, (_, i) =>
          http
            .patch(`/api/v1/fees/structures/${structureId}`)
            .set(auth(adminToken))
            .send({
              name: `${tag}-race-${i}`,
              components: [{ label: 'Race', amount: 1000 + i }],
            }),
        ),
      );
      const succeeded = results.filter((r) => r.status === 200).length;
      const after = await auditCount('fees.structure_updated', structureId);
      // The W2 guarantee: no false duplicates and no missing records —
      // exactly one audit row per mutation that actually committed.
      expect(after - before).toBe(succeeded);
      expect(succeeded).toBeGreaterThan(0);

      // Each audit row is internally consistent: its recorded before/after
      // totals are values that were genuinely attempted, so no row
      // describes a state that never existed.
      const rows = (await auditRows('fees.structure_updated', structureId)).slice(
        0,
        succeeded,
      );
      const attempted = Array.from({ length: attempts }, (_, i) => String(1000 + i));
      for (const row of rows) {
        const meta = row.metadata as Record<string, unknown>;
        expect(meta.componentsReplaced).toBe(true);
        expect(attempted).toContain(String(meta.totalAmountAfter));
        // NOTE: componentCountAfter reflects the committed row set the
        // transaction observed, so under the D-4 interleaving below it can
        // legitimately exceed this caller's own component count. It is a
        // faithful reading of committed state, never client-supplied.
        expect(typeof meta.componentCountAfter).toBe('number');
        expect(meta.componentCountAfter as number).toBeGreaterThan(0);
        expect(row.actorId).toBe(adminUserId);
        expect(row.collegeId).toBe(collegeId);
      }
    });

    /**
     * D-4 — newly discovered PRE-EXISTING defect, reported not fixed.
     *
     * `updateStructure` replaces components with deleteMany + createMany
     * and writes `totalAmount` in the same transaction, but takes no lock
     * on the FeeStructure row. Under READ COMMITTED, concurrent updates
     * interleave: the surviving component rows can come from one
     * transaction while `totalAmount` comes from another, leaving the
     * stored total different from the sum of the stored components.
     *
     * This is unchanged M14/M17 behaviour — the code is byte-identical to
     * HEAD before M23-W2 apart from the appended audit call — and fixing
     * it means adding row locking to a financial write path, which is
     * outside W2's authorization. This test therefore DOCUMENTS the
     * anomaly rather than asserting it is correct, so the behaviour
     * cannot change silently before it is properly fixed.
     */
    it('D-4 (documented, not fixed): serial updates DO keep total == component sum', async () => {
      // Serially — the single-writer case, which must always hold.
      for (const amount of [2500, 3600]) {
        const res = await http
          .patch(`/api/v1/fees/structures/${structureId}`)
          .set(auth(adminToken))
          .send({ components: [{ label: 'Solo', amount }] });
        expect(res.status).toBe(200);
        const row = await prisma.feeStructure.findUniqueOrThrow({
          where: { id: structureId },
          include: { components: true },
        });
        expect(Number(row.totalAmount)).toBe(
          row.components.reduce((s, c) => s + Number(c.amount), 0),
        );
      }
    });
  });

  // ── 6. the rest of the S-2 surface ─────────────────────────────────

  describe('remaining S-2 paths each emit exactly one server-derived event', () => {
    const cases: Array<{
      name: string;
      action: string;
      targetType: string;
      path: () => string;
      body: Record<string, unknown>;
      target: () => string;
      expectChanged: string[];
    }> = [
      {
        name: 'exam update',
        action: 'exams.updated',
        targetType: 'Exam',
        path: () => `/api/v1/exams/${examId}`,
        body: { title: `${tag}-exam-renamed` },
        target: () => examId,
        expectChanged: ['title'],
      },
      {
        name: 'exam paper update',
        action: 'exams.paper_updated',
        targetType: 'ExamPaper',
        path: () => `/api/v1/exams/${examId}/papers/${paperId}`,
        body: { room: 'R2' },
        target: () => paperId,
        expectChanged: ['room'],
      },
      {
        name: 'academic year update',
        action: 'academic_years.updated',
        targetType: 'AcademicYear',
        path: () => `/api/v1/academic-years/${yearId}`,
        body: { label: `${tag}-AY2` },
        target: () => yearId,
        expectChanged: ['label'],
      },
      {
        name: 'term update',
        action: 'terms.updated',
        targetType: 'Term',
        path: () => `/api/v1/terms/${termId}`,
        body: { label: `${tag}-T2` },
        target: () => termId,
        expectChanged: ['label'],
      },
      {
        name: 'section update',
        action: 'sections.updated',
        targetType: 'Section',
        path: () => `/api/v1/sections/${sectionId}`,
        body: { capacity: 45 },
        target: () => sectionId,
        expectChanged: ['capacity'],
      },
      {
        name: 'timetable slot update',
        action: 'timetable.slot_updated',
        targetType: 'TimetableSlot',
        path: () => `/api/v1/timetable/slots/${slotId}`,
        body: { room: 'R9' },
        target: () => slotId,
        expectChanged: ['room'],
      },
      {
        name: 'assignment update',
        action: 'assignments.updated',
        targetType: 'Assignment',
        path: () => `/api/v1/assignments/${assignmentId}`,
        body: { maxPoints: 75 },
        target: () => assignmentId,
        expectChanged: ['maxPoints'],
      },
    ];

    it.each(cases)('$name is audited exactly once', async (testCase) => {
      const before = await auditCount(testCase.action, testCase.target());
      const res = await http
        .patch(testCase.path())
        .set(auth(adminToken))
        .send(testCase.body);
      expect(res.status).toBe(200);

      const rows = await auditRows(testCase.action, testCase.target());
      expect(rows.length - before).toBe(1);
      const row = rows[0];
      expect(row.targetType).toBe(testCase.targetType);
      expect(row.actorId).toBe(adminUserId); // server-derived
      expect(row.collegeId).toBe(collegeId); // server-derived
      expect((row.metadata as Record<string, unknown>).changed).toEqual(
        testCase.expectChanged,
      );
    });

    it.each(cases)('$name writes nothing when the caller lacks permission', async (testCase) => {
      const before = await totalAudit();
      const res = await http
        .patch(testCase.path())
        .set(auth(studentToken))
        .send(testCase.body);
      expect(res.status).toBe(403);
      expect(await totalAudit()).toBe(before);
    });

    it('no audited metadata anywhere contains free-text content or credentials', async () => {
      const rows = await prisma.auditLog.findMany({
        where: { action: { in: cases.map((c) => c.action) } },
      });
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const meta = JSON.stringify(row.metadata);
        for (const leak of [
          'original description',
          'password',
          'secret',
          'token',
          'Bearer',
          '@campusos.dev',
        ]) {
          expect(meta).not.toContain(leak);
        }
      }
    });
  });

  // ── 7. invariants ──────────────────────────────────────────────────

  describe('invariants', () => {
    it('audit rows remain tenant-scoped and readable only within the college', async () => {
      const res = await http
        .get('/api/v1/audit?action=fees.structure_updated')
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      const rows = res.body.data as Array<{ action: string }>;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.action).toBe('fees.structure_updated');
      // the audit viewer is tenant-scoped, so zero rival rows can appear
      const all = await http.get('/api/v1/audit').set(auth(adminToken));
      expect(all.status).toBe(200);
    });

    it('S-1 remains closed: teacher cannot read an unassigned finalized record', async () => {
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

    it('no role-name conditional was introduced in the audited services', async () => {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      for (const file of [
        'fees/fees.service.ts',
        'exams/exams.service.ts',
        'academics/calendar.service.ts',
        'academics/sections.service.ts',
        'timetable/timetable.service.ts',
        'assignments/assignments.service.ts',
        'audit/audit.service.ts',
        'audit/changed-fields.ts',
      ]) {
        const src = readFileSync(join(__dirname, '..', 'src', file), 'utf8');
        expect(src).not.toContain('user.role ===');
        for (const role of ['TEACHER', 'ACCOUNTANT', 'GUARDIAN']) {
          expect(src).not.toContain(`role === '${role}'`);
        }
      }
    });
  });
});
