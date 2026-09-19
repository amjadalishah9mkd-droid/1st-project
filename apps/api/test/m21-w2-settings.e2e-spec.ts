import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M21-W2 — settings completion + O-5/O-6.
 * Real-Postgres coverage: attendanceWarningThreshold schema/PATCH
 * validation, tenancy, audit, read-only surfacing on both attendance
 * summaries, reserved-locale passthrough preservation (O-5), and
 * unchanged-lifecycle regression guard.
 */
describe('M21-W2 — settings & threshold surfacing', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = `w2s-${Date.now().toString(36)}`;

  let collegeId: string;
  let adminToken: string;
  let studentToken: string;
  let teacherToken: string;
  let originalSettings: unknown;

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
    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
    originalSettings = (
      await prisma.college.findUniqueOrThrow({ where: { id: collegeId } })
    ).settings;
    adminToken = await login('admin@campusos.dev');
    studentToken = await login('student@campusos.dev');
    teacherToken = await login('teacher@campusos.dev');
  });

  afterAll(async () => {
    // Restore demo settings exactly.
    await prisma.college.update({
      where: { id: collegeId },
      data: { settings: originalSettings as never },
    });
    await app.close();
  });

  it('GET settings includes the threshold with its default; authorization unchanged', async () => {
    expect((await http.get('/api/v1/settings/college')).status).toBe(401);
    expect(
      (await http.get('/api/v1/settings/college').set(auth(studentToken)))
        .status,
    ).toBe(403);
    expect(
      (await http.get('/api/v1/settings/college').set(auth(teacherToken)))
        .status,
    ).toBe(403);
    const res = await http
      .get('/api/v1/settings/college')
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.settings.attendanceWarningThreshold).toBe(75);
  });

  it('PATCH validates bounds and persists; change is audited; unrelated keys survive', async () => {
    for (const bad of [-1, 101, 12.5, 'high']) {
      const res = await http
        .patch('/api/v1/settings/college')
        .set(auth(adminToken))
        .send({ attendanceWarningThreshold: bad });
      expect(res.status).toBe(400);
    }
    // Unknown keys are rejected by the strict PATCH schema (no smuggling).
    const smuggle = await http
      .patch('/api/v1/settings/college')
      .set(auth(adminToken))
      .send({ attendanceWarningThreshold: 80, collegeId: 'attacker' });
    expect(smuggle.status).toBe(400);

    const before = await prisma.auditLog.count({
      where: { collegeId, action: 'settings.updated' },
    });
    const ok = await http
      .patch('/api/v1/settings/college')
      .set(auth(adminToken))
      .send({ attendanceWarningThreshold: 90 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.settings.attendanceWarningThreshold).toBe(90);
    // Existing google settings preserved by the merge.
    expect(ok.body.data.settings.googleAuth).toBeDefined();
    expect(
      await prisma.auditLog.count({
        where: { collegeId, action: 'settings.updated' },
      }),
    ).toBe(before + 1);
  });

  it('O-5: the reserved locale key survives every settings write untouched', async () => {
    // Simulate legacy/raw data carrying locale (as the seed does).
    const college = await prisma.college.findUniqueOrThrow({
      where: { id: collegeId },
    });
    const withLocale = {
      ...(college.settings as Record<string, unknown>),
      locale: 'en',
      customFutureKey: 'preserved',
    };
    await prisma.college.update({
      where: { id: collegeId },
      data: { settings: withLocale as never },
    });
    const res = await http
      .patch('/api/v1/settings/college')
      .set(auth(adminToken))
      .send({ attendanceWarningThreshold: 85 });
    expect(res.status).toBe(200);
    const after = await prisma.college.findUniqueOrThrow({
      where: { id: collegeId },
    });
    const settings = after.settings as Record<string, unknown>;
    expect(settings.locale).toBe('en'); // passthrough preserved
    expect(settings.customFutureKey).toBe('preserved');
    expect(settings.attendanceWarningThreshold).toBe(85);
    // Locale is NOT patchable (reserved, no functionality).
    const patchLocale = await http
      .patch('/api/v1/settings/college')
      .set(auth(adminToken))
      .send({ locale: 'fr' });
    expect(patchLocale.status).toBe(400);
  });

  it('O-6: attendance summaries surface the threshold and per-row flags, display-only', async () => {
    // Set an extreme threshold so the demo student's 100% attendance flips
    // the flag deterministically in both directions.
    await http
      .patch('/api/v1/settings/college')
      .set(auth(adminToken))
      .send({ attendanceWarningThreshold: 100 });
    // Snapshot: threshold changes must not touch attendance records.
    const recordCount = await prisma.attendanceRecord.count();

    const strict = await http
      .get('/api/v1/attendance/summary')
      .set(auth(studentToken));
    expect(strict.status).toBe(200);
    expect(strict.body.data.kind).toBe('student');
    expect(strict.body.data.warningThreshold).toBe(100);
    for (const section of strict.body.data.sections as Array<{
      percentage: number | null;
      belowThreshold: boolean;
    }>) {
      expect(section.belowThreshold).toBe(
        section.percentage !== null && section.percentage < 100,
      );
    }

    await http
      .patch('/api/v1/settings/college')
      .set(auth(adminToken))
      .send({ attendanceWarningThreshold: 0 });
    const lax = await http
      .get('/api/v1/attendance/summary')
      .set(auth(studentToken));
    expect(lax.body.data.warningThreshold).toBe(0);
    for (const section of lax.body.data.sections as Array<{
      belowThreshold: boolean;
    }>) {
      expect(section.belowThreshold).toBe(false); // nothing is below 0
    }

    // Section-scoped summary (teacher) carries the same fields.
    const section = await prisma.section.findFirstOrThrow({
      where: {
        collegeId,
        teachingAssignments: {
          some: { teacher: { user: { email: 'teacher@campusos.dev' } } },
        },
      },
    });
    const teacherView = await http
      .get(`/api/v1/attendance/summary?sectionId=${section.id}`)
      .set(auth(teacherToken));
    expect(teacherView.status).toBe(200);
    expect(teacherView.body.data.kind).toBe('section');
    expect(teacherView.body.data.warningThreshold).toBe(0);
    for (const student of teacherView.body.data.summary.students as Array<{
      belowThreshold: boolean;
    }>) {
      expect(student.belowThreshold).toBe(false);
    }

    // Display-only proof: records and calculations untouched.
    expect(await prisma.attendanceRecord.count()).toBe(recordCount);
  });

  it('tenancy: a rival-college admin edits only their own settings', async () => {
    const argon2 = await import('argon2');
    const rival = await prisma.college.create({
      data: { name: 'Rival W2S', code: `RVW2S-${suffix}` },
    });
    const rivalAdmin = await prisma.user.create({
      data: {
        college: { connect: { id: rival.id } },
        email: `w2s-rival-${suffix}@campusos.dev`,
        passwordHash: await argon2.hash(DEMO_PASSWORD, {
          type: argon2.argon2id,
        }),
        role: 'ADMIN',
        firstName: 'Rival',
        lastName: 'W2S',
        mustChangePassword: false,
      },
    });
    try {
      const rivalToken = await login(rivalAdmin.email);
      const res = await http
        .patch('/api/v1/settings/college')
        .set(auth(rivalToken))
        .send({ attendanceWarningThreshold: 10 });
      expect(res.status).toBe(200);
      // Demo college settings unaffected by the rival's write.
      const demo = await prisma.college.findUniqueOrThrow({
        where: { id: collegeId },
      });
      expect(
        (demo.settings as Record<string, unknown>).attendanceWarningThreshold,
      ).not.toBe(10);
      const rivalRow = await prisma.college.findUniqueOrThrow({
        where: { id: rival.id },
      });
      expect(
        (rivalRow.settings as Record<string, unknown>)
          .attendanceWarningThreshold,
      ).toBe(10);
    } finally {
      await prisma.refreshToken.deleteMany({
        where: { userId: rivalAdmin.id },
      });
      await prisma.auditLog.deleteMany({ where: { collegeId: rival.id } });
      await prisma.user.delete({ where: { id: rivalAdmin.id } });
      await prisma.college.delete({ where: { id: rival.id } });
    }
  });

  it('regression: W1 lifecycle semantics are untouched by settings work', async () => {
    // Threshold writes never touch user status; the lifecycle endpoints
    // still enforce self-protection exactly as in W1.
    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    const res = await http
      .post(`/api/v1/users/${admin.id}/suspend`)
      .set(auth(adminToken))
      .send({ reason: 'settings regression probe' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_SELF');
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: admin.id } }))
        .status,
    ).toBe('ACTIVE');
  });
});
