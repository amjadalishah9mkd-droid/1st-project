import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ROUTE_PERMISSIONS } from '@campusos/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M12-W4 — read-only audit log viewer.
 * audit.read (ADMIN/ALL via PolicyService); tenant-scoped; adversarial
 * cross-college and read-only contracts included.
 */
describe('M12-W4 — audit log viewer', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let rivalCollegeId: string;
  let adminId: string;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  let rivalAdminToken: string;
  let rivalAdminId: string;
  const fixtureIds: string[] = [];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function seedAudit(
    college: string,
    action: string,
    actorId: string | null,
    createdAt: Date,
    targetId?: string,
  ) {
    const row = await prisma.auditLog.create({
      data: {
        collegeId: college,
        actorId,
        action,
        targetType: 'Test',
        targetId: targetId ?? `t-${suffix}`,
        metadata: { fixture: suffix },
        createdAt,
      },
    });
    fixtureIds.push(row.id);
    return row;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const argon2 = await import('argon2');
    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
    adminId = admin.id;
    const rival = await prisma.college.create({
      data: { name: 'Rival Audit College', code: `RVA-${suffix}` },
    });
    rivalCollegeId = rival.id;
    const rivalAdmin = await prisma.user.create({
      data: {
        college: { connect: { id: rival.id } },
        email: `rva-admin-${suffix}@campusos.dev`,
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        role: 'ADMIN',
        firstName: 'Rva',
        lastName: 'Admin',
        mustChangePassword: false,
      },
    });
    rivalAdminId = rivalAdmin.id;

    adminToken = await login('admin@campusos.dev');
    teacherToken = await login('teacher@campusos.dev');
    studentToken = await login('student@campusos.dev');
    rivalAdminToken = await login(rivalAdmin.email);

    // Fixtures: two demo-college rows (one old, one system) + one rival row.
    await seedAudit(collegeId, `w4test.alpha.${suffix}`, adminId, new Date('2020-01-15T12:00:00Z'), `alpha-${suffix}`);
    await seedAudit(collegeId, `w4test.beta.${suffix}`, null, new Date(), `beta-${suffix}`);
    await seedAudit(rivalCollegeId, `w4test.rival.${suffix}`, rivalAdminId, new Date(), `rival-${suffix}`);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { id: { in: fixtureIds } } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ actorId: rivalAdminId }, { targetId: rivalAdminId }, { collegeId: rivalCollegeId }],
      },
    });
    await prisma.user.delete({ where: { id: rivalAdminId } });
    await prisma.college.delete({ where: { id: rivalCollegeId } });
    await app.close();
  });

  describe('authorization', () => {
    it('anonymous → 401; teacher and student → 403 (permission, not role)', async () => {
      expect((await http.get('/api/v1/audit')).status).toBe(401);
      expect((await http.get('/api/v1/audit').set(auth(teacherToken))).status).toBe(403);
      expect((await http.get('/api/v1/audit').set(auth(studentToken))).status).toBe(403);
    });

    it('audit.read is seeded ADMIN/ALL + ACCOUNTANT/ALL (M16 D-6) and mapped on /audit', async () => {
      const grants = await prisma.rolePermission.findMany({
        where: { permission: { key: 'audit.read' } },
        include: { permission: true },
      });
      // M16-W1 (decision D-6): the finance-only ACCOUNTANT role also holds
      // full audit.read; no other role may.
      expect(grants.map((g) => g.role).sort()).toEqual(['ACCOUNTANT', 'ADMIN']);
      expect(grants.every((g) => g.scope === 'ALL')).toBe(true);
      expect(ROUTE_PERMISSIONS['/audit']).toBe('audit.read');
    });

    it('the audit module is read-only: no mutation routes exist', async () => {
      for (const method of ['post', 'patch', 'put', 'delete'] as const) {
        const res = await http[method]('/api/v1/audit').set(auth(adminToken));
        expect([404, 405]).toContain(res.status);
      }
    });
  });

  describe('listing, filters, tenancy', () => {
    it('admin lists newest-first with {data, meta} and joined actor', async () => {
      const res = await http
        .get(`/api/v1/audit?q=w4test.beta.${suffix}`)
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(1);
      const row = res.body.data[0];
      expect(row.action).toBe(`w4test.beta.${suffix}`);
      expect(row.actor).toBeNull(); // system entry
      expect(row.metadata).toEqual({ fixture: suffix });

      const withActor = await http
        .get(`/api/v1/audit?q=w4test.alpha.${suffix}`)
        .set(auth(adminToken));
      expect(withActor.body.data[0].actor.email).toBe('admin@campusos.dev');
    });

    it('ordering is createdAt desc', async () => {
      const res = await http
        .get(`/api/v1/audit?action=w4test.`)
        .set(auth(adminToken));
      expect(res.body.data.length).toBe(2); // rival row excluded by tenancy
      const [first, second] = res.body.data;
      expect(new Date(first.createdAt).getTime()).toBeGreaterThan(
        new Date(second.createdAt).getTime(),
      );
    });

    it('action prefix, actorId and date-window filters work', async () => {
      const prefix = await http
        .get(`/api/v1/audit?action=w4test.alpha`)
        .set(auth(adminToken));
      expect(prefix.body.meta.total).toBe(1);

      const byActor = await http
        .get(`/api/v1/audit?action=w4test.&actorId=${adminId}`)
        .set(auth(adminToken));
      expect(byActor.body.meta.total).toBe(1);
      expect(byActor.body.data[0].action).toContain('alpha');

      const window = await http
        .get('/api/v1/audit?action=w4test.&from=2020-01-15&to=2020-01-15')
        .set(auth(adminToken));
      expect(window.body.meta.total).toBe(1);
      expect(window.body.data[0].action).toContain('alpha');

      const empty = await http
        .get('/api/v1/audit?action=w4test.&from=1999-01-01&to=1999-01-02')
        .set(auth(adminToken));
      expect(empty.body.meta.total).toBe(0);
    });

    it('q matches exact targetId', async () => {
      const res = await http
        .get(`/api/v1/audit?q=alpha-${suffix}`)
        .set(auth(adminToken));
      expect(res.body.meta.total).toBe(1);
    });

    it('pagination slices with correct meta', async () => {
      const page1 = await http
        .get('/api/v1/audit?action=w4test.&limit=1&page=1')
        .set(auth(adminToken));
      const page2 = await http
        .get('/api/v1/audit?action=w4test.&limit=1&page=2')
        .set(auth(adminToken));
      expect(page1.body.data).toHaveLength(1);
      expect(page2.body.data).toHaveLength(1);
      expect(page1.body.meta.total).toBe(2);
      expect(page1.body.data[0].id).not.toBe(page2.body.data[0].id);
    });

    it('adversarial tenancy: rival admin never sees demo-college rows, even filtering by foreign ids', async () => {
      const own = await http
        .get('/api/v1/audit?action=w4test.')
        .set(auth(rivalAdminToken));
      expect(own.body.meta.total).toBe(1);
      expect(own.body.data[0].action).toBe(`w4test.rival.${suffix}`);

      // Filtering by the DEMO admin's actorId or targetId leaks nothing.
      const byForeignActor = await http
        .get(`/api/v1/audit?actorId=${adminId}`)
        .set(auth(rivalAdminToken));
      expect(byForeignActor.body.meta.total).toBe(0);
      const byForeignTarget = await http
        .get(`/api/v1/audit?q=alpha-${suffix}`)
        .set(auth(rivalAdminToken));
      expect(byForeignTarget.body.meta.total).toBe(0);

      // And the demo admin never sees the rival row.
      const demoSide = await http
        .get(`/api/v1/audit?q=rival-${suffix}`)
        .set(auth(adminToken));
      expect(demoSide.body.meta.total).toBe(0);
    });
  });
});
