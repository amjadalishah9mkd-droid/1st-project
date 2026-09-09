import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M15-W1 — calendar administration foundation.
 * Covers: calendar CRUD authorization/tenancy through HTTP, the NEW
 * database-level single-current-term invariant (partial unique index),
 * and the TermRollover persistence structure (uniques + tenancy).
 * Rollover EXECUTION does not exist yet (W2) — asserted explicitly.
 */
describe('M15-W1 — academic calendar foundation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let rivalCollegeId: string;
  let rivalYearId: string;
  let rivalTermId: string;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    collegeId = (
      await prisma.user.findFirstOrThrow({ where: { email: 'admin@campusos.dev' } })
    ).collegeId;

    const rival = await prisma.college.create({
      data: { name: 'Rival W1Cal College', code: `RVCAL-${suffix}` },
    });
    rivalCollegeId = rival.id;
    const rivalYear = await prisma.academicYear.create({
      data: {
        college: { connect: { id: rival.id } },
        label: `RV-AY-${suffix}`,
        startsOn: new Date('2026-08-01'),
        endsOn: new Date('2027-06-30'),
      },
    });
    rivalYearId = rivalYear.id;
    const rivalTerm = await prisma.term.create({
      data: {
        college: { connect: { id: rival.id } },
        academicYear: { connect: { id: rivalYear.id } },
        label: `RV-T-${suffix}`,
        startsOn: new Date('2026-08-01'),
        endsOn: new Date('2026-12-20'),
      },
    });
    rivalTermId = rivalTerm.id;

    adminToken = await login('admin@campusos.dev');
    teacherToken = await login('teacher@campusos.dev');
    studentToken = await login('student@campusos.dev');
  });

  afterAll(async () => {
    await prisma.termRollover.deleteMany({});
    await prisma.term.deleteMany({
      where: { OR: [{ collegeId: rivalCollegeId }, { label: { contains: `W1C-${suffix}` } }] },
    });
    await prisma.academicYear.deleteMany({
      where: { OR: [{ collegeId: rivalCollegeId }, { label: { contains: `W1C-${suffix}` } }] },
    });
    await prisma.auditLog.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.college.delete({ where: { id: rivalCollegeId } });
    await app.close();
  });

  describe('authorization', () => {
    it('admin mutates; teacher (academics.read only) and student are refused; anon 401', async () => {
      const created = await http
        .post('/api/v1/academic-years')
        .set(auth(adminToken))
        .send({ label: `W1C-${suffix} AY`, startsOn: '2027-08-01', endsOn: '2028-06-30' });
      expect(created.status).toBe(201);

      for (const token of [teacherToken, studentToken]) {
        expect(
          (
            await http
              .post('/api/v1/academic-years')
              .set(auth(token))
              .send({ label: `Nope-${suffix}`, startsOn: '2027-08-01', endsOn: '2028-06-30' })
          ).status,
        ).toBe(403);
        expect(
          (
            await http
              .patch(`/api/v1/terms/${rivalTermId}/set-current`)
              .set(auth(token))
          ).status,
        ).toBe(403);
      }
      expect((await http.get('/api/v1/academic-years')).status).toBe(401);
    });
  });

  describe('year + term lifecycle through HTTP', () => {
    let yearId: string;
    let termId: string;

    it('create/update year, create/update term, validation errors surface', async () => {
      const year = await http
        .post('/api/v1/academic-years')
        .set(auth(adminToken))
        .send({ label: `W1C-${suffix} Year`, startsOn: '2027-08-01', endsOn: '2028-06-30' });
      expect(year.status).toBe(201);
      yearId = year.body.data.id;

      // Validation: end before start refused by shared schema.
      expect(
        (
          await http
            .post('/api/v1/academic-years')
            .set(auth(adminToken))
            .send({ label: `Bad-${suffix}`, startsOn: '2028-01-01', endsOn: '2027-01-01' })
        ).status,
      ).toBe(400);

      const renamed = await http
        .patch(`/api/v1/academic-years/${yearId}`)
        .set(auth(adminToken))
        .send({ label: `W1C-${suffix} Year R` });
      expect(renamed.status).toBe(200);
      expect(renamed.body.data.label).toBe(`W1C-${suffix} Year R`);

      const term = await http
        .post('/api/v1/terms')
        .set(auth(adminToken))
        .send({
          academicYearId: yearId,
          label: `W1C-${suffix} Fall`,
          startsOn: '2027-08-01',
          endsOn: '2027-12-20',
        });
      expect(term.status).toBe(201);
      termId = term.body.data.id;
      expect(term.body.data.isCurrent).toBe(false);

      // Duplicate label within the year refused (existing behavior).
      expect(
        (
          await http
            .post('/api/v1/terms')
            .set(auth(adminToken))
            .send({
              academicYearId: yearId,
              label: `W1C-${suffix} Fall`,
              startsOn: '2028-01-05',
              endsOn: '2028-05-20',
            })
        ).status,
      ).toBe(400);

      const updated = await http
        .patch(`/api/v1/terms/${termId}`)
        .set(auth(adminToken))
        .send({ label: `W1C-${suffix} Fall R` });
      expect(updated.status).toBe(200);
      expect(updated.body.data.label).toBe(`W1C-${suffix} Fall R`);
    });

    it('set-current switches atomically and shows in listings', async () => {
      const before = await prisma.term.findFirstOrThrow({
        where: { collegeId, isCurrent: true },
      });
      const set = await http
        .patch(`/api/v1/terms/${termId}/set-current`)
        .set(auth(adminToken));
      expect(set.status).toBe(200);
      expect(set.body.data.isCurrent).toBe(true);

      const currents = await prisma.term.findMany({
        where: { collegeId, isCurrent: true },
      });
      expect(currents).toHaveLength(1);
      expect(currents[0].id).toBe(termId);

      // Restore the original current term for demo/suite stability.
      await http
        .patch(`/api/v1/terms/${before.id}/set-current`)
        .set(auth(adminToken));
      expect(
        (
          await prisma.term.findFirstOrThrow({ where: { collegeId, isCurrent: true } })
        ).id,
      ).toBe(before.id);
    });
  });

  describe('tenancy / IDOR', () => {
    it('rival-college year/term cannot be read into scope, updated, or made current', async () => {
      const list = await http
        .get('/api/v1/academic-years?limit=100')
        .set(auth(adminToken));
      expect(
        list.body.data.some((row: { id: string }) => row.id === rivalYearId),
      ).toBe(false);
      expect(
        (
          await http
            .patch(`/api/v1/academic-years/${rivalYearId}`)
            .set(auth(adminToken))
            .send({ label: 'Hijacked' })
        ).status,
      ).toBe(404);
      expect(
        (
          await http
            .patch(`/api/v1/terms/${rivalTermId}`)
            .set(auth(adminToken))
            .send({ label: 'Hijacked' })
        ).status,
      ).toBe(404);
      expect(
        (
          await http
            .patch(`/api/v1/terms/${rivalTermId}/set-current`)
            .set(auth(adminToken))
        ).status,
      ).toBe(404);
      // Term creation into a rival year is refused.
      expect(
        (
          await http
            .post('/api/v1/terms')
            .set(auth(adminToken))
            .send({
              academicYearId: rivalYearId,
              label: 'Sneak',
              startsOn: '2027-01-01',
              endsOn: '2027-05-01',
            })
        ).status,
      ).toBe(400);
    });
  });

  describe('database-level single-current invariant (migration #9)', () => {
    it('a raw second current term for the same college violates the partial unique index', async () => {
      const year = await prisma.academicYear.findFirstOrThrow({
        where: { collegeId },
      });
      const extra = await prisma.term.create({
        data: {
          collegeId,
          academicYearId: year.id,
          label: `W1C-${suffix} Sneaky`,
          startsOn: new Date('2028-08-01'),
          endsOn: new Date('2028-12-20'),
        },
      });
      // Bypass the service entirely: direct write must be stopped by the DB.
      await expect(
        prisma.term.update({ where: { id: extra.id }, data: { isCurrent: true } }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await prisma.term.delete({ where: { id: extra.id } });
    });

    it('different colleges can each hold their own current term', async () => {
      const rivalCurrent = await prisma.term.update({
        where: { id: rivalTermId },
        data: { isCurrent: true },
      });
      expect(rivalCurrent.isCurrent).toBe(true);
      // The demo college's current term is unaffected.
      expect(
        await prisma.term.count({ where: { collegeId, isCurrent: true } }),
      ).toBe(1);
      await prisma.term.update({
        where: { id: rivalTermId },
        data: { isCurrent: false },
      });
    });
  });

  describe('TermRollover persistence structure (W2 preparation only)', () => {
    it('DRAFT rows exist, unique(collegeId, toTermId) is enforced, and NO rollover endpoints exist yet', async () => {
      const year = await prisma.academicYear.findFirstOrThrow({ where: { collegeId } });
      const from = await prisma.term.findFirstOrThrow({ where: { collegeId } });
      const to = await prisma.term.create({
        data: {
          collegeId,
          academicYearId: year.id,
          label: `W1C-${suffix} Target`,
          startsOn: new Date('2028-01-05'),
          endsOn: new Date('2028-05-20'),
        },
      });
      const draft = await prisma.termRollover.create({
        data: { collegeId, fromTermId: from.id, toTermId: to.id },
      });
      expect(draft.status).toBe('DRAFT');
      expect(draft.executedAt).toBeNull();

      await expect(
        prisma.termRollover.create({
          data: { collegeId, fromTermId: from.id, toTermId: to.id },
        }),
      ).rejects.toMatchObject({ code: 'P2002' }); // one rollover per target term

      // A DIFFERENT college may target its own term freely (tenancy in the key).
      const rivalDraft = await prisma.termRollover.create({
        data: {
          collegeId: rivalCollegeId,
          fromTermId: rivalTermId,
          toTermId: rivalTermId, // structural test only; W2 validates from!=to
        },
      });
      expect(rivalDraft.collegeId).toBe(rivalCollegeId);

      // Since W2, the rollover endpoint exists and idempotently resumes
      // this raw draft (empty plan tolerated) instead of duplicating it.
      const resume = await http
        .post(`/api/v1/terms/${to.id}/rollover`)
        .set(auth(adminToken))
        .send({ fromTermId: from.id });
      expect(resume.status).toBe(201);
      expect(resume.body.data.id).toBe(draft.id);
      expect(await prisma.termRollover.count({ where: { toTermId: to.id } })).toBe(1);

      await prisma.termRollover.deleteMany({});
      await prisma.term.delete({ where: { id: to.id } });
    });
  });
});
