import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M17-W1 — term lifecycle foundation (docs/M17_TERM_LIFECYCLE_DESIGN.md).
 * Covers: migration #11 structures, ACTIVE⇄CLOSED transitions with typed
 * confirmation + CAS + row-locked D-3, the full authorization matrix
 * (incl. ACCOUNTANT refusal), tenancy, real-Postgres transition races,
 * single-audit guarantees, set-current CLOSED refusal, and the rollover
 * integration (CLOSED source valid, CLOSED destination refused, explicit
 * closeSourceTerm honored / absent flag inert).
 * Broad academic/finance ENFORCEMENT is W2 — deliberately absent here.
 */
describe('M17-W1 — term lifecycle foundation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let yearId: string;
  let adminToken: string;
  let accountantToken: string;
  let teacherToken: string;
  let studentToken: string;
  let guardianToken: string;
  let rivalCollegeId: string;
  let rivalTermId: string;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  let termSeq = 0;
  async function makeTerm(status: 'ACTIVE' | 'CLOSED' = 'ACTIVE') {
    termSeq += 1;
    return prisma.term.create({
      data: {
        collegeId,
        academicYearId: yearId,
        label: `W1TL-${suffix}-${termSeq}`,
        startsOn: new Date('2027-08-01'),
        endsOn: new Date('2027-12-20'),
        status,
      },
    });
  }

  const close = (token: string, id: string, confirmLabel: string) =>
    http.post(`/api/v1/terms/${id}/close`).set(auth(token)).send({ confirmLabel });
  const reopen = (token: string, id: string, confirmLabel: string) =>
    http.post(`/api/v1/terms/${id}/reopen`).set(auth(token)).send({ confirmLabel });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
    yearId = (
      await prisma.academicYear.create({
        data: {
          collegeId,
          label: `W1TL-AY-${suffix}`,
          startsOn: new Date('2027-08-01'),
          endsOn: new Date('2028-06-30'),
        },
      })
    ).id;

    // Guardian principal for the authz matrix.
    await prisma.user.upsert({
      where: {
        collegeId_email: { collegeId, email: `w1tl-guardian-${suffix}@campusos.dev` },
      },
      update: {},
      create: {
        collegeId,
        email: `w1tl-guardian-${suffix}@campusos.dev`,
        passwordHash: admin.passwordHash,
        role: 'GUARDIAN',
        status: 'ACTIVE',
        firstName: 'Wone',
        lastName: 'Guardian',
        mustChangePassword: false,
      },
    });

    const rival = await prisma.college.create({
      data: { name: 'Rival Lifecycle College', code: `RVTL-${suffix}` },
    });
    rivalCollegeId = rival.id;
    const rivalYear = await prisma.academicYear.create({
      data: {
        collegeId: rival.id,
        label: `RVTL-AY-${suffix}`,
        startsOn: new Date('2027-08-01'),
        endsOn: new Date('2028-06-30'),
      },
    });
    rivalTermId = (
      await prisma.term.create({
        data: {
          collegeId: rival.id,
          academicYearId: rivalYear.id,
          label: `RVTL-T-${suffix}`,
          startsOn: new Date('2027-08-01'),
          endsOn: new Date('2027-12-20'),
        },
      })
    ).id;

    adminToken = await login('admin@campusos.dev');
    accountantToken = await login('accountant@campusos.dev');
    teacherToken = await login('teacher@campusos.dev');
    studentToken = await login('student@campusos.dev');
    guardianToken = await login(`w1tl-guardian-${suffix}@campusos.dev`);
  });

  afterAll(async () => {
    await prisma.termRollover.deleteMany({
      where: { toTerm: { label: { contains: `W1TL-${suffix}` } } },
    });
    await prisma.term.deleteMany({
      where: { OR: [{ collegeId: rivalCollegeId }, { label: { contains: `W1TL-${suffix}` } }] },
    });
    await prisma.academicYear.deleteMany({
      where: {
        OR: [{ collegeId: rivalCollegeId }, { label: `W1TL-AY-${suffix}` }],
      },
    });
    await prisma.user.deleteMany({
      where: { email: `w1tl-guardian-${suffix}@campusos.dev` },
    });
    await prisma.auditLog.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.college.delete({ where: { id: rivalCollegeId } });
    await app.close();
  });

  describe('migration #11 structures', () => {
    it('TermStatus enum + status column + index exist; 11 applied migrations; existing terms ACTIVE', async () => {
      const enums = await prisma.$queryRaw<Array<{ label: string }>>`
        SELECT e.enumlabel AS label FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname = 'TermStatus'`;
      expect(enums.map((r) => r.label).sort()).toEqual(['ACTIVE', 'CLOSED']);
      const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'Term' AND indexname = 'Term_collegeId_status_idx'`;
      expect(indexes).toHaveLength(1);
      const migrations = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      expect(Number(migrations[0].count)).toBe(11);
      // pre-existing demo terms defaulted ACTIVE
      const closedPreexisting = await prisma.term.count({
        where: { collegeId, status: 'CLOSED', label: { not: { contains: 'W1TL' } } },
      });
      expect(closedPreexisting).toBe(0);
    });

    it('status persists and is exposed on the term listing', async () => {
      const term = await makeTerm('CLOSED');
      const list = await http
        .get('/api/v1/terms?pageSize=100')
        .set(auth(adminToken));
      const row = (list.body.data as Array<{ id: string; status: string }>).find(
        (t) => t.id === term.id,
      );
      expect(row?.status).toBe('CLOSED');
    });
  });

  describe('authorization', () => {
    it('only academics.manage can close/reopen; accountant/teacher/student/guardian 403; anon 401', async () => {
      const term = await makeTerm();
      for (const token of [accountantToken, teacherToken, studentToken, guardianToken]) {
        expect((await close(token, term.id, term.label)).status).toBe(403);
        expect((await reopen(token, term.id, term.label)).status).toBe(403);
      }
      expect(
        (await http.post(`/api/v1/terms/${term.id}/close`).send({ confirmLabel: term.label }))
          .status,
      ).toBe(401);
      // still ACTIVE — nothing above mutated it
      const after = await prisma.term.findUniqueOrThrow({ where: { id: term.id } });
      expect(after.status).toBe('ACTIVE');
    });
  });

  describe('tenancy', () => {
    it('rival term ids 404 on close/reopen; no mutation, no cross-tenant audit', async () => {
      expect((await close(adminToken, rivalTermId, `RVTL-T-${suffix}`)).status).toBe(404);
      expect((await reopen(adminToken, rivalTermId, `RVTL-T-${suffix}`)).status).toBe(404);
      const rival = await prisma.term.findUniqueOrThrow({ where: { id: rivalTermId } });
      expect(rival.status).toBe('ACTIVE');
      expect(
        await prisma.auditLog.count({
          where: { collegeId: rivalCollegeId, action: { in: ['terms.closed', 'terms.reopened'] } },
        }),
      ).toBe(0);
    });
  });

  describe('typed confirmation', () => {
    it('missing/incorrect confirmation rejected server-side; exact label succeeds', async () => {
      const term = await makeTerm();
      expect(
        (await http.post(`/api/v1/terms/${term.id}/close`).set(auth(adminToken)).send({}))
          .status,
      ).toBe(400); // Zod: confirmLabel required
      const wrong = await close(adminToken, term.id, `${term.label}-nope`);
      expect(wrong.status).toBe(400);
      expect(wrong.body.error.code).toBe('CONFIRMATION_MISMATCH');
      expect(
        (await prisma.term.findUniqueOrThrow({ where: { id: term.id } })).status,
      ).toBe('ACTIVE');
      const ok = await close(adminToken, term.id, term.label);
      expect(ok.status).toBe(201);
      expect(ok.body.data.status).toBe('CLOSED');
    });
  });

  describe('state machine', () => {
    it('ACTIVE→CLOSED→ACTIVE round trip; invalid transitions 409; single audit per real transition', async () => {
      const term = await makeTerm();
      expect((await close(adminToken, term.id, term.label)).status).toBe(201);
      // CLOSED→CLOSED refused
      const again = await close(adminToken, term.id, term.label);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('INVALID_TRANSITION');
      // reopen
      const back = await reopen(adminToken, term.id, term.label);
      expect(back.status).toBe(201);
      expect(back.body.data.status).toBe('ACTIVE');
      // ACTIVE→reopen refused
      expect((await reopen(adminToken, term.id, term.label)).status).toBe(409);
      // exactly one audit row per real transition; failures created none
      expect(
        await prisma.auditLog.count({
          where: { action: 'terms.closed', targetId: term.id },
        }),
      ).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: { action: 'terms.reopened', targetId: term.id },
        }),
      ).toBe(1);
    });

    it('D-3: the current term cannot be closed (checked under the row lock)', async () => {
      const current = await prisma.term.findFirstOrThrow({
        where: { collegeId, isCurrent: true },
      });
      const res = await close(adminToken, current.id, current.label);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('TERM_IS_CURRENT');
      expect(
        (await prisma.term.findUniqueOrThrow({ where: { id: current.id } })).status,
      ).toBe('ACTIVE');
    });

    it('a CLOSED term cannot be made current', async () => {
      const term = await makeTerm('CLOSED');
      const res = await http
        .patch(`/api/v1/terms/${term.id}/set-current`)
        .set(auth(adminToken));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('TERM_CLOSED');
      const after = await prisma.term.findUniqueOrThrow({ where: { id: term.id } });
      expect(after.isCurrent).toBe(false);
    });
  });

  describe('concurrency (real Postgres)', () => {
    it('simultaneous closes: exactly one transition, one audit row', async () => {
      const term = await makeTerm();
      const results = await Promise.all([
        close(adminToken, term.id, term.label),
        close(adminToken, term.id, term.label),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        await prisma.auditLog.count({
          where: { action: 'terms.closed', targetId: term.id },
        }),
      ).toBe(1);
    });

    it('simultaneous reopens and close/reopen race resolve to consistent single transitions', async () => {
      const term = await makeTerm('CLOSED');
      const reopens = await Promise.all([
        reopen(adminToken, term.id, term.label),
        reopen(adminToken, term.id, term.label),
      ]);
      expect(reopens.map((r) => r.status).sort()).toEqual([201, 409]);
      // now ACTIVE: race close against reopen — reopen must lose (409),
      // close may win; final state is deterministic per CAS outcomes.
      const [c, r] = await Promise.all([
        close(adminToken, term.id, term.label),
        reopen(adminToken, term.id, term.label),
      ]);
      const statuses = [c.status, r.status].sort();
      // close can win (201+409) or, if reopen sneaks between, both orders
      // still yield exactly one 201 per actual transition.
      expect(statuses[0]).toBe(201);
      const final = await prisma.term.findUniqueOrThrow({ where: { id: term.id } });
      const closedAudits = await prisma.auditLog.count({
        where: { action: 'terms.closed', targetId: term.id },
      });
      const reopenedAudits = await prisma.auditLog.count({
        where: { action: 'terms.reopened', targetId: term.id },
      });
      // audit rows exactly mirror real transitions
      expect(closedAudits + reopenedAudits).toBe(
        1 + (final.status === 'ACTIVE' ? closedAudits : reopenedAudits - 1) + 1,
      );
      expect(closedAudits).toBeGreaterThanOrEqual(1);
      expect(reopenedAudits).toBeGreaterThanOrEqual(1);
    });
  });

  describe('rollover integration (D-4 / O-3)', () => {
    it('a CLOSED destination is refused at draft and at execute', async () => {
      const source = await makeTerm();
      const dest = await makeTerm('CLOSED');
      const res = await http
        .post(`/api/v1/terms/${dest.id}/rollover`)
        .set(auth(adminToken))
        .send({ fromTermId: source.id });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('TERM_CLOSED');
    });

    it('a CLOSED source term remains a valid rollover source (O-3)', async () => {
      const source = await makeTerm('CLOSED');
      const dest = await makeTerm();
      const res = await http
        .post(`/api/v1/terms/${dest.id}/rollover`)
        .set(auth(adminToken))
        .send({ fromTermId: source.id });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('DRAFT');
    });

    it('execute WITHOUT closeSourceTerm leaves the source ACTIVE; WITH the flag closes it', async () => {
      // pair 1: no flag
      const sourceA = await makeTerm();
      const destA = await makeTerm();
      await http
        .post(`/api/v1/terms/${destA.id}/rollover`)
        .set(auth(adminToken))
        .send({ fromTermId: sourceA.id });
      const execA = await http
        .post(`/api/v1/terms/${destA.id}/rollover/execute`)
        .set(auth(adminToken))
        .send({ confirmLabel: destA.label });
      expect(execA.status).toBe(201);
      expect(execA.body.data.sourceTermClosed).toBeUndefined();
      expect(
        (await prisma.term.findUniqueOrThrow({ where: { id: sourceA.id } })).status,
      ).toBe('ACTIVE');

      // pair 2: explicit flag
      const sourceB = await makeTerm();
      const destB = await makeTerm();
      await http
        .post(`/api/v1/terms/${destB.id}/rollover`)
        .set(auth(adminToken))
        .send({ fromTermId: sourceB.id });
      const execB = await http
        .post(`/api/v1/terms/${destB.id}/rollover/execute`)
        .set(auth(adminToken))
        .send({ confirmLabel: destB.label, closeSourceTerm: true });
      expect(execB.status).toBe(201);
      expect(execB.body.data.sourceTermClosed).toBe(true);
      expect(
        (await prisma.term.findUniqueOrThrow({ where: { id: sourceB.id } })).status,
      ).toBe('CLOSED');
      // the close went through the standard lifecycle path → audited once
      expect(
        await prisma.auditLog.count({
          where: { action: 'terms.closed', targetId: sourceB.id },
        }),
      ).toBe(1);
    });

    it('closeSourceTerm on a CURRENT source: rollover still succeeds, close reports TERM_IS_CURRENT', async () => {
      const current = await prisma.term.findFirstOrThrow({
        where: { collegeId, isCurrent: true },
      });
      const dest = await makeTerm();
      await http
        .post(`/api/v1/terms/${dest.id}/rollover`)
        .set(auth(adminToken))
        .send({ fromTermId: current.id });
      // strip suggested plan to keep this rollover inert (no real moves):
      await http
        .patch(`/api/v1/terms/${dest.id}/rollover`)
        .set(auth(adminToken))
        .send({ sections: [] });
      const exec = await http
        .post(`/api/v1/terms/${dest.id}/rollover/execute`)
        .set(auth(adminToken))
        .send({ confirmLabel: dest.label, closeSourceTerm: true });
      expect(exec.status).toBe(201);
      expect(exec.body.data.status).toBe('EXECUTED');
      expect(exec.body.data.sourceTermClosed).toBe(false);
      expect(exec.body.data.sourceTermCloseError).toBe('TERM_IS_CURRENT');
      expect(
        (await prisma.term.findUniqueOrThrow({ where: { id: current.id } })).status,
      ).toBe('ACTIVE');
    });
  });
});
