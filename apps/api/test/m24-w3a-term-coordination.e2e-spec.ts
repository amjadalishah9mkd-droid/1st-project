import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const PASSWORD = 'CampusOS!demo1';

describe('M24-W3a — academic Term lock coordination (real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let seq = 0;

  interface Fixture {
    collegeId: string;
    adminId: string;
    studentUserId: string;
    studentId: string;
    yearId: string;
    courseId: string;
    sourceId: string;
    destId: string;
    currentId: string;
    sectionId: string;
    sourceLabel: string;
    destLabel: string;
    token: string;
  }

  const auth = (f: Fixture) => ({ Authorization: `Bearer ${f.token}` });
  const draft = (f: Fixture, to = f.destId, from = f.sourceId) =>
    http.post(`/api/v1/terms/${to}/rollover`).set(auth(f)).send({ fromTermId: from });
  const execute = (f: Fixture, to = f.destId, label = f.destLabel) =>
    http.post(`/api/v1/terms/${to}/rollover/execute`).set(auth(f)).send({ confirmLabel: label });
  const close = (f: Fixture) =>
    http.post(`/api/v1/terms/${f.sourceId}/close`).set(auth(f)).send({ confirmLabel: f.sourceLabel });
  const setCurrent = (f: Fixture, id: string) =>
    http.patch(`/api/v1/terms/${id}/set-current`).set(auth(f));

  async function fixture(): Promise<Fixture> {
    const tag = `${suffix}-${++seq}`;
    const college = await prisma.college.create({
      data: { name: `W3A College ${tag}`, code: `W3A-${tag}` },
    });
    const demo = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
      select: { passwordHash: true },
    });
    const admin = await prisma.user.create({
      data: {
        collegeId: college.id,
        email: `w3a-admin-${tag}@example.test`,
        passwordHash: demo.passwordHash,
        role: 'ADMIN',
        firstName: 'W3a',
        lastName: 'Admin',
        mustChangePassword: false,
      },
    });
    const studentUser = await prisma.user.create({
      data: {
        collegeId: college.id,
        email: `w3a-student-${tag}@example.test`,
        role: 'STUDENT',
        firstName: 'W3a',
        lastName: 'Student',
      },
    });
    const dept = await prisma.department.create({
      data: { collegeId: college.id, name: 'Test', code: 'TEST' },
    });
    const student = await prisma.studentProfile.create({
      data: {
        userId: studentUser.id,
        collegeId: college.id,
        departmentId: dept.id,
        admissionNo: `W3A-${tag}`,
        rollNo: `W3A-${tag}`,
        batch: '2039',
      },
    });
    const year = await prisma.academicYear.create({
      data: {
        collegeId: college.id,
        label: `W3A-${tag}`,
        startsOn: new Date('2039-01-01'),
        endsOn: new Date('2039-12-31'),
      },
    });
    const sourceLabel = `Source-${tag}`;
    const destLabel = `Dest-${tag}`;
    const [source, dest, current] = await Promise.all([
      prisma.term.create({ data: {
        collegeId: college.id, academicYearId: year.id, label: sourceLabel,
        startsOn: new Date('2039-01-01'), endsOn: new Date('2039-04-30'),
      } }),
      prisma.term.create({ data: {
        collegeId: college.id, academicYearId: year.id, label: destLabel,
        startsOn: new Date('2039-05-01'), endsOn: new Date('2039-08-31'),
      } }),
      prisma.term.create({ data: {
        collegeId: college.id, academicYearId: year.id, label: `Current-${tag}`,
        startsOn: new Date('2039-09-01'), endsOn: new Date('2039-12-31'),
        isCurrent: true,
      } }),
    ]);
    const course = await prisma.course.create({
      data: { collegeId: college.id, departmentId: dept.id, code: `W3A-${tag}`.slice(0, 24), title: 'Term race', credits: 3 },
    });
    const section = await prisma.section.create({
      data: { collegeId: college.id, termId: source.id, courseId: course.id, name: 'A', capacity: 5 },
    });
    await prisma.enrollment.create({ data: { sectionId: section.id, studentId: student.id } });
    app.get(LoginRateLimiterService).reset();
    const login = await http.post('/api/v1/auth/login').send({ email: admin.email, password: PASSWORD });
    expect(login.status).toBe(200);
    return {
      collegeId: college.id, adminId: admin.id, studentUserId: studentUser.id,
      studentId: student.id, yearId: year.id, courseId: course.id,
      sourceId: source.id, destId: dest.id, currentId: current.id,
      sectionId: section.id, sourceLabel, destLabel,
      token: login.body.data.accessToken as string,
    };
  }

  async function cleanup(f: Fixture): Promise<void> {
    await prisma.notification.deleteMany({ where: { userId: { in: [f.adminId, f.studentUserId] } } });
    await prisma.refreshToken.deleteMany({ where: { userId: f.adminId } });
    await prisma.auditLog.deleteMany({ where: { collegeId: f.collegeId } });
    await prisma.enrollment.deleteMany({ where: { section: { collegeId: f.collegeId } } });
    await prisma.teachingAssignment.deleteMany({ where: { section: { collegeId: f.collegeId } } });
    await prisma.termRollover.deleteMany({ where: { collegeId: f.collegeId } });
    await prisma.section.deleteMany({ where: { collegeId: f.collegeId } });
    await prisma.course.deleteMany({ where: { collegeId: f.collegeId } });
    await prisma.term.deleteMany({ where: { collegeId: f.collegeId } });
    await prisma.academicYear.deleteMany({ where: { collegeId: f.collegeId } });
    await prisma.studentProfile.delete({ where: { id: f.studentId } });
    await prisma.user.deleteMany({ where: { id: { in: [f.adminId, f.studentUserId] } } });
    await prisma.department.deleteMany({ where: { collegeId: f.collegeId } });
    await prisma.college.delete({ where: { id: f.collegeId } });
  }

  async function waitFor(check: () => Promise<boolean>, what: string, timeout = 3_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  async function tableWait(name: string): Promise<boolean> {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      'SELECT count(*) AS n FROM pg_locks WHERE relation = $1::regclass AND NOT granted',
      `"${name}"`,
    );
    return Number(rows[0].n) > 0;
  }

  async function advisoryWait(): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
    return Number(rows[0].n) > 0;
  }

  function barrier(table: 'AuditLog' | 'Enrollment' | 'TermRollover') {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    class Rollback extends Error {}
    const done = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`LOCK TABLE "${table}" IN EXCLUSIVE MODE`);
      await held;
      throw new Rollback();
    }, { timeout: 30_000, maxWait: 10_000 }).catch((e) => {
      if (!(e instanceof Rollback)) throw e;
    });
    return { release, done };
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());
  });
  afterAll(async () => { await app.close(); });

  it('close-first: the rollover reads CLOSED after waiting for source FOR UPDATE', async () => {
    const f = await fixture();
    const pending: Array<Promise<request.Response>> = [];
    let gate: ReturnType<typeof barrier> | undefined;
    try {
      expect((await draft(f)).status).toBe(201);
      gate = barrier('AuditLog');
      await waitFor(async () => {
        const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*) AS n FROM pg_locks WHERE relation = '"AuditLog"'::regclass AND mode = 'ExclusiveLock' AND granted`;
        return Number(rows[0].n) > 0;
      }, 'audit barrier');
      pending.push((async () => await close(f))());
      await waitFor(() => tableWait('AuditLog'), 'close to park after source lock');
      pending.push((async () => await execute(f))());
      await waitFor(async () => {
        const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*) AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query LIKE '%FROM "Term"%' AND query LIKE '%FOR SHARE%'`;
        return Number(rows[0].n) > 0;
      }, 'rollover to wait for source Term');
      gate.release();
      await gate.done;
      const [closed, rolled] = await Promise.all(pending);
      expect(closed.status).toBe(201);
      expect(rolled.status).toBe(201);
      expect(rolled.body.data.counters.enrollmentsCompleted).toBe(0);
      expect((await prisma.enrollment.findFirstOrThrow({ where: { sectionId: f.sectionId } })).status).toBe('ACTIVE');
      expect((await prisma.term.findUniqueOrThrow({ where: { id: f.sourceId } })).status).toBe('CLOSED');
    } finally {
      gate?.release();
      await gate?.done.catch(() => undefined);
      await Promise.allSettled(pending);
      await cleanup(f);
    }
  }, 60_000);

  it('rollover-first: source close waits until source enrollment conclusion commits', async () => {
    const f = await fixture();
    const pending: Array<Promise<request.Response>> = [];
    try {
      expect((await draft(f)).status).toBe(201);
      const gate = barrier('Enrollment');
      try {
        await waitFor(async () => {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM pg_locks WHERE relation = '"Enrollment"'::regclass AND mode = 'ExclusiveLock' AND granted`;
          return Number(rows[0].n) > 0;
        }, 'enrollment barrier');
        pending.push((async () => await execute(f))());
        await waitFor(() => tableWait('Enrollment'), 'rollover to park before source writes');
        pending.push((async () => await close(f))());
        await waitFor(async () => {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND query LIKE '%FROM "Term"%' AND query LIKE '%FOR UPDATE%'`;
          return Number(rows[0].n) > 0;
        }, 'source close to wait for rollover');
        gate.release();
        await gate.done;
        const [rolled, closed] = await Promise.all(pending);
        expect(rolled.status).toBe(201);
        expect(rolled.body.data.counters.enrollmentsCompleted).toBe(1);
        expect(closed.status).toBe(201);
        expect((await prisma.enrollment.findFirstOrThrow({ where: { sectionId: f.sectionId } })).status).toBe('COMPLETED');
        expect((await prisma.term.findUniqueOrThrow({ where: { id: f.sourceId } })).status).toBe('CLOSED');
      } finally {
        gate.release();
        await gate.done.catch(() => undefined);
        await Promise.allSettled(pending);
      }
    } finally { await cleanup(f); }
  }, 60_000);

  it.each(['source', 'destination'] as const)('set-current targeting %s waits behind rollover', async (target) => {
    const f = await fixture();
    const pending: Array<Promise<request.Response>> = [];
    try {
      expect((await draft(f)).status).toBe(201);
      const gate = barrier('TermRollover');
      try {
        await waitFor(async () => {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM pg_locks WHERE relation = '"TermRollover"'::regclass AND mode = 'ExclusiveLock' AND granted`;
          return Number(rows[0].n) > 0;
        }, 'rollover row barrier');
        pending.push((async () => await execute(f))());
        await waitFor(() => tableWait('TermRollover'), 'rollover to park on row lock');
        const targetId = target === 'source' ? f.sourceId : f.destId;
        pending.push((async () => await setCurrent(f, targetId))());
        await waitFor(advisoryWait, 'set-current to wait for advisory lock');
        gate.release();
        await gate.done;
        const [rolled, current] = await Promise.all(pending);
        expect(rolled.status).toBe(201);
        expect(current.status).toBe(200);
        expect((await prisma.term.findUniqueOrThrow({ where: { id: targetId } })).isCurrent).toBe(true);
        expect(await prisma.term.count({ where: { collegeId: f.collegeId, isCurrent: true } })).toBe(1);
      } finally {
        gate.release();
        await gate.done.catch(() => undefined);
        await Promise.allSettled(pending);
      }
    } finally { await cleanup(f); }
  }, 60_000);

  it('draft creation holds advisory lock before its INSERT and source FK checks', async () => {
    const f = await fixture();
    const pending: Array<Promise<request.Response>> = [];
    const gate = barrier('TermRollover');
    try {
      await waitFor(async () => {
        const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*) AS n FROM pg_locks WHERE relation = '"TermRollover"'::regclass AND mode = 'ExclusiveLock' AND granted`;
        return Number(rows[0].n) > 0;
      }, 'draft barrier');
      pending.push((async () => await draft(f))());
      await waitFor(() => tableWait('TermRollover'), 'draft to park on insert');
      pending.push((async () => await setCurrent(f, f.sourceId))());
      await waitFor(advisoryWait, 'set-current to wait for draft advisory lock');
      gate.release();
      await gate.done;
      const [created, current] = await Promise.all(pending);
      expect(created.status).toBe(201);
      expect(current.status).toBe(200);
      expect(await prisma.termRollover.count({ where: { collegeId: f.collegeId, toTermId: f.destId } })).toBe(1);
    } finally {
      gate.release();
      await gate.done.catch(() => undefined);
      await Promise.allSettled(pending);
      await cleanup(f);
    }
  }, 60_000);

  it('duplicate execute waits on advisory lock and gets ALREADY_EXECUTED', async () => {
    const f = await fixture();
    const pending: Array<Promise<request.Response>> = [];
    try {
      expect((await draft(f)).status).toBe(201);
      const gate = barrier('TermRollover');
      try {
        await waitFor(async () => {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM pg_locks WHERE relation = '"TermRollover"'::regclass AND mode = 'ExclusiveLock' AND granted`;
          return Number(rows[0].n) > 0;
        }, 'duplicate barrier');
        pending.push((async () => await execute(f))());
        await waitFor(() => tableWait('TermRollover'), 'first execute to park');
        pending.push((async () => await execute(f))());
        await waitFor(advisoryWait, 'second execute to wait on advisory lock');
        gate.release();
        await gate.done;
        const [first, second] = await Promise.all(pending);
        expect(first.status).toBe(201);
        expect(second.status).toBe(409);
        expect(second.body.error.code).toBe('ALREADY_EXECUTED');
        expect(await prisma.auditLog.count({ where: { collegeId: f.collegeId, action: 'terms.rollover_executed' } })).toBe(1);
      } finally {
        gate.release();
        await gate.done.catch(() => undefined);
        await Promise.allSettled(pending);
      }
    } finally { await cleanup(f); }
  }, 60_000);

  it('opposing rollovers with valid empty-term drafts serialize without a Term lock cycle', async () => {
    const f = await fixture();
    const pending: Array<Promise<request.Response>> = [];
    try {
      // Both target Terms must be empty at draft time. The populated source
      // fixture is not used here; the domain does not prohibit empty plans.
      const [a, b] = await Promise.all([
        prisma.term.create({ data: {
          collegeId: f.collegeId, academicYearId: f.yearId,
          label: `Opp-A-${suffix}-${seq}`, startsOn: new Date('2039-01-01'), endsOn: new Date('2039-04-30'),
        } }),
        prisma.term.create({ data: {
          collegeId: f.collegeId, academicYearId: f.yearId,
          label: `Opp-B-${suffix}-${seq}`, startsOn: new Date('2039-05-01'), endsOn: new Date('2039-08-31'),
        } }),
      ]);
      expect((await draft(f, b.id, a.id)).status).toBe(201);
      expect((await draft(f, a.id, b.id)).status).toBe(201);

      const gate = barrier('TermRollover');
      try {
        await waitFor(async () => {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM pg_locks WHERE relation = '"TermRollover"'::regclass AND mode = 'ExclusiveLock' AND granted`;
          return Number(rows[0].n) > 0;
        }, 'opposing rollover barrier');
        pending.push((async () => await execute(f, b.id, b.label))());
        await waitFor(() => tableWait('TermRollover'), 'first opposing rollover to park');
        pending.push((async () => await execute(f, a.id, a.label))());
        await waitFor(advisoryWait, 'second opposing rollover to wait on advisory lock');
        gate.release();
        await gate.done;
        const [first, second] = await Promise.all(pending);
        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        expect(await prisma.termRollover.count({
          where: { collegeId: f.collegeId, status: 'EXECUTED', toTermId: { in: [a.id, b.id] } },
        })).toBe(2);
      } finally {
        gate.release();
        await gate.done.catch(() => undefined);
        await Promise.allSettled(pending);
      }
    } finally { await cleanup(f); }
  }, 60_000);

  it('current-Term protection remains intact while rollover is in flight', async () => {
    const f = await fixture();
    const pending: Array<Promise<request.Response>> = [];
    try {
      expect((await draft(f)).status).toBe(201);
      // A database-owned row lock parks set-current after its target lock
      // and advisory claim, on the previously current Term.
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const holder = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Term" WHERE id = ${f.currentId} FOR UPDATE`;
        await held;
      }, { timeout: 30_000 });
      try {
        await waitFor(async () => {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM pg_locks WHERE relation = '"Term"'::regclass AND mode = 'RowShareLock' AND granted`;
          return Number(rows[0].n) > 0;
        }, 'current row holder');
        pending.push((async () => await setCurrent(f, f.sourceId))());
        await waitFor(async () => {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM pg_locks WHERE NOT granted`;
          return Number(rows[0].n) > 0;
        }, 'set-current to wait on previous current Term');
        pending.push((async () => await execute(f))());
        await waitFor(advisoryWait, 'rollover to wait on set-current');
        pending.push((async () => await close(f))());
        await waitFor(async () => {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND query LIKE '%FROM "Term"%' AND query LIKE '%FOR UPDATE%'`;
          return Number(rows[0].n) > 0;
        }, 'source close to wait for set-current target');
        release();
        await holder;
        const [current, rolled, refused] = await Promise.all(pending);
        expect(current.status).toBe(200);
        expect(rolled.status).toBe(201);
        expect(refused.status).toBe(400);
        expect(refused.body.error.code).toBe('TERM_IS_CURRENT');
        expect(await prisma.term.count({ where: { collegeId: f.collegeId, isCurrent: true } })).toBe(1);
      } finally {
        release();
        await holder.catch(() => undefined);
        await Promise.allSettled(pending);
      }
    } finally { await cleanup(f); }
  }, 60_000);
});
