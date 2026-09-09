import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { PERMISSIONS } from '@campusos/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { PolicyService } from '../src/access/policy.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp, cookieValue } from './test-app';
import type { AuthenticatedUser } from '../src/access/authenticated-user';

const DEMO_PASSWORD = 'CampusOS!demo1';
const ADMIN = 'admin@campusos.dev';
const TEACHER = 'teacher@campusos.dev';
const STUDENT = 'student@campusos.dev';

describe('M1 — Auth & Access', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let policy: PolicyService;
  let limiter: LoginRateLimiterService;
  let http: ReturnType<typeof request>;
  const cleanupUserIds: string[] = [];
  const cleanupSectionIds: string[] = [];
  let cleanupCourseId: string | null = null;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    policy = app.get(PolicyService);
    limiter = app.get(LoginRateLimiterService);
    http = request(app.getHttpServer());
  });

  beforeEach(() => limiter.reset());

  afterAll(async () => {
    for (const sectionId of cleanupSectionIds) {
      await prisma.teachingAssignment.deleteMany({ where: { sectionId } });
      await prisma.section.delete({ where: { id: sectionId } }).catch(() => {});
    }
    if (cleanupCourseId) {
      await prisma.course.delete({ where: { id: cleanupCourseId } }).catch(() => {});
    }
    for (const userId of cleanupUserIds) {
      await prisma.auditLog.deleteMany({ where: { actorId: userId } });
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
    await app.close();
  });

  async function login(email: string, password = DEMO_PASSWORD) {
    return http.post('/api/v1/auth/login').send({ email, password });
  }

  async function loggedInUser(email: string) {
    const res = await login(email);
    expect(res.status).toBe(200);
    return {
      accessToken: res.body.data.accessToken as string,
      refreshCookie: cookieValue(res.headers, 'cos_refresh')!,
      user: res.body.data.user,
    };
  }

  async function createTempUser(overrides: {
    email: string;
    role: 'ADMIN' | 'TEACHER' | 'STUDENT';
    status?: 'ACTIVE' | 'SUSPENDED';
    mustChangePassword?: boolean;
  }) {
    const college = await prisma.college.findFirstOrThrow();
    const user = await prisma.user.create({
      data: {
        collegeId: college.id,
        email: overrides.email,
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        role: overrides.role,
        status: overrides.status ?? 'ACTIVE',
        firstName: 'Temp',
        lastName: 'User',
        mustChangePassword: overrides.mustChangePassword ?? false,
      },
    });
    cleanupUserIds.push(user.id);
    return user;
  }

  // ── Authentication ─────────────────────────────────────────

  it('M0 regression: health endpoint still works', async () => {
    const res = await http.get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.database).toBe('up');
  });

  it.each([
    [ADMIN, 'ADMIN'],
    [TEACHER, 'TEACHER'],
    [STUDENT, 'STUDENT'],
  ])('logs in %s as %s with envelope + cookies', async (email, role) => {
    const res = await login(email);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.role).toBe(role);
    expect(res.body.data.user.permissions.length).toBeGreaterThan(0);
    expect(cookieValue(res.headers, 'cos_refresh')).toBeDefined();
    expect(cookieValue(res.headers, 'cos_auth')).toBeDefined();
    const refreshCookieHeader = (res.headers['set-cookie'] as unknown as string[])
      .find((c: string) => c.startsWith('cos_refresh='))!;
    expect(refreshCookieHeader).toContain('HttpOnly');
    expect(refreshCookieHeader).toContain('SameSite=Lax');
    expect(refreshCookieHeader).toContain('Secure');
    expect(refreshCookieHeader).toContain('Path=/api/v1/auth');
  });

  it('rejects invalid credentials with a generic message (no enumeration)', async () => {
    const wrongPassword = await login(ADMIN, 'definitely-wrong-1A');
    const unknownUser = await login('ghost@campusos.dev', 'definitely-wrong-1A');
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownUser.body.error.message);
    expect(wrongPassword.body.error.message).toBe('Invalid email or password');
  });

  it('access JWT payload contains ONLY sub, role, collegeId (+iat/exp) — no permissions', async () => {
    const { accessToken } = await loggedInUser(ADMIN);
    const payload = JSON.parse(
      Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'),
    );
    expect(Object.keys(payload).sort()).toEqual(
      ['collegeId', 'exp', 'iat', 'role', 'sub'].sort(),
    );
    expect(payload.permissions).toBeUndefined();
  });

  it('stores refresh tokens hashed — raw token never appears in the database', async () => {
    const { refreshCookie, user } = await loggedInUser(ADMIN);
    const rows = await prisma.refreshToken.findMany({
      where: { userId: user.id },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.tokenHash === refreshCookie)).toBe(false);
    expect(refreshCookie.length).toBeGreaterThanOrEqual(64);
  });

  // ── Refresh rotation & reuse detection ─────────────────────

  it('rotates the refresh token on refresh', async () => {
    const { refreshCookie } = await loggedInUser(ADMIN);
    const res = await http
      .post('/api/v1/auth/refresh')
      .set('Cookie', `cos_refresh=${refreshCookie}`);
    expect(res.status).toBe(200);
    const rotated = cookieValue(res.headers, 'cos_refresh')!;
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(refreshCookie);

    // The rotated token works.
    const res2 = await http
      .post('/api/v1/auth/refresh')
      .set('Cookie', `cos_refresh=${rotated}`);
    expect(res2.status).toBe(200);
  });

  it('detects refresh-token reuse and revokes the whole family', async () => {
    const { refreshCookie: tokenA, user } = await loggedInUser(ADMIN);
    const rotateRes = await http
      .post('/api/v1/auth/refresh')
      .set('Cookie', `cos_refresh=${tokenA}`);
    const tokenB = cookieValue(rotateRes.headers, 'cos_refresh')!;

    // Replay the revoked token A → reuse detected.
    const reuse = await http
      .post('/api/v1/auth/refresh')
      .set('Cookie', `cos_refresh=${tokenA}`);
    expect(reuse.status).toBe(401);

    // The whole family is dead: B no longer works.
    const afterReuse = await http
      .post('/api/v1/auth/refresh')
      .set('Cookie', `cos_refresh=${tokenB}`);
    expect(afterReuse.status).toBe(401);

    // Family revocation is audited.
    const audit = await prisma.auditLog.findFirst({
      where: { actorId: user.id, action: 'auth.token_family_revoked' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
  });

  it('logout revokes the session', async () => {
    const { refreshCookie } = await loggedInUser(TEACHER);
    const logoutRes = await http
      .post('/api/v1/auth/logout')
      .set('Cookie', `cos_refresh=${refreshCookie}`);
    expect(logoutRes.status).toBe(200);

    const res = await http
      .post('/api/v1/auth/refresh')
      .set('Cookie', `cos_refresh=${refreshCookie}`);
    expect(res.status).toBe(401);
  });

  it('suspended users cannot refresh', async () => {
    const temp = await createTempUser({
      email: `suspended-${Date.now()}@campusos.dev`,
      role: 'STUDENT',
    });
    const { refreshCookie } = await loggedInUser(temp.email);
    await prisma.user.update({
      where: { id: temp.id },
      data: { status: 'SUSPENDED' },
    });
    const res = await http
      .post('/api/v1/auth/refresh')
      .set('Cookie', `cos_refresh=${refreshCookie}`);
    expect(res.status).toBe(401);
  });

  // ── Forced password change ─────────────────────────────────

  it('enforces forced password change end to end', async () => {
    const temp = await createTempUser({
      email: `forced-${Date.now()}@campusos.dev`,
      role: 'ADMIN',
      mustChangePassword: true,
    });
    const { accessToken } = await loggedInUser(temp.email);

    // Normal API access is blocked…
    const blocked = await http
      .get('/api/v1/access/permissions')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    // …but /me remains available.
    const me = await http
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.mustChangePassword).toBe(true);

    // Change the password → flag clears, access opens.
    const change = await http
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: DEMO_PASSWORD, newPassword: 'BrandNew!pass9' });
    expect(change.status).toBe(200);

    const unblocked = await http
      .get('/api/v1/access/permissions')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(unblocked.status).toBe(200);

    const audit = await prisma.auditLog.findFirst({
      where: { actorId: temp.id, action: 'auth.password_changed' },
    });
    expect(audit).not.toBeNull();
  });

  // ── Authorization ──────────────────────────────────────────

  it('rejects protected routes without authentication', async () => {
    const me = await http.get('/api/v1/me');
    const perms = await http.get('/api/v1/access/permissions');
    expect(me.status).toBe(401);
    expect(perms.status).toBe(401);
  });

  it('denies permission for roles without the grant (student, teacher)', async () => {
    const student = await loggedInUser(STUDENT);
    const teacher = await loggedInUser(TEACHER);
    for (const session of [student, teacher]) {
      const res = await http
        .get('/api/v1/access/permissions')
        .set('Authorization', `Bearer ${session.accessToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('grants permission for the admin role (settings.manage → matrix payload)', async () => {
    const { accessToken } = await loggedInUser(ADMIN);
    const res = await http
      .get('/api/v1/access/permissions')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    // Catalog always mirrors the shared permission source of truth.
    expect(res.body.data.catalog.length).toBe(Object.keys(PERMISSIONS).length);
    expect(res.body.data.matrix.length).toBe(res.body.data.expectedGrantCount);
  });

  it('permissions are resolved from the database, not the JWT (matrix edit is honored)', async () => {
    const { accessToken } = await loggedInUser(ADMIN);
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { key: 'settings.manage' },
    });
    // Remove the grant from the DB while keeping the same JWT.
    await prisma.rolePermission.delete({
      where: { role_permissionId: { role: 'ADMIN', permissionId: permission.id } },
    });
    policy.invalidateCache();
    try {
      const res = await http
        .get('/api/v1/access/permissions')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(403); // same token, new DB state → denied
    } finally {
      await prisma.rolePermission.create({
        data: { role: 'ADMIN', permissionId: permission.id, scope: 'ALL' },
      });
      policy.invalidateCache();
    }
  });

  // ── Scope semantics (PolicyService) ────────────────────────

  function asAuthUser(user: {
    id: string;
    collegeId: string;
    email: string;
    role: string;
  }): AuthenticatedUser {
    return {
      id: user.id,
      collegeId: user.collegeId,
      email: user.email,
      role: user.role as AuthenticatedUser['role'],
      status: 'ACTIVE',
      verificationStatus: 'LEGACY',
      firstName: 'x',
      lastName: 'x',
      avatarUrl: null,
      mustChangePassword: false,
    };
  }

  it('OWN scope: students read their own results only', async () => {
    const student = await prisma.user.findFirstOrThrow({
      where: { email: STUDENT },
    });
    const other = await prisma.user.findFirstOrThrow({
      where: { email: TEACHER },
    });
    const self = asAuthUser(student);
    expect(await policy.can(self, 'results.read', { ownerUserId: student.id })).toBe(true);
    expect(await policy.can(self, 'results.read', { ownerUserId: other.id })).toBe(false);
    // List-level access (service self-scopes)
    expect(await policy.can(self, 'results.read', {})).toBe(true);
  });

  it('ASSIGNED scope: teachers act only on sections they teach', async () => {
    const teacherUser = await prisma.user.findFirstOrThrow({
      where: { email: TEACHER },
      include: { teacherProfile: true },
    });
    const term = await prisma.term.findFirstOrThrow({ where: { isCurrent: true } });
    const department = await prisma.department.findFirstOrThrow();
    const course = await prisma.course.create({
      data: {
        collegeId: teacherUser.collegeId,
        departmentId: department.id,
        code: `TST-${Date.now()}`,
        title: 'Scope Test Course',
        credits: 3,
      },
    });
    cleanupCourseId = course.id;
    const assignedSection = await prisma.section.create({
      data: {
        collegeId: teacherUser.collegeId,
        courseId: course.id,
        termId: term.id,
        name: 'A',
        capacity: 30,
      },
    });
    const otherSection = await prisma.section.create({
      data: {
        collegeId: teacherUser.collegeId,
        courseId: course.id,
        termId: term.id,
        name: 'B',
        capacity: 30,
      },
    });
    cleanupSectionIds.push(assignedSection.id, otherSection.id);
    await prisma.teachingAssignment.create({
      data: {
        teacherId: teacherUser.teacherProfile!.id,
        sectionId: assignedSection.id,
        isPrimary: true,
      },
    });

    const teacher = asAuthUser(teacherUser);
    expect(
      await policy.can(teacher, 'attendance.record', { sectionId: assignedSection.id }),
    ).toBe(true);
    expect(
      await policy.can(teacher, 'attendance.record', { sectionId: otherSection.id }),
    ).toBe(false);
  });

  it('ALL scope: admin permission applies regardless of resource context', async () => {
    const adminUser = await prisma.user.findFirstOrThrow({ where: { email: ADMIN } });
    const admin = asAuthUser(adminUser);
    expect(await policy.can(admin, 'users.manage', {})).toBe(true);
    expect(
      await policy.can(admin, 'users.manage', { ownerUserId: 'someone-else' }),
    ).toBe(true);
    expect(
      await policy.can(admin, 'attendance.record', { sectionId: 'any-section' }),
    ).toBe(true);
  });

  it('audit records exist for login success, failure and logout', async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { email: ADMIN } });
    await login(ADMIN, 'wrong-password-1A'); // failure
    const { refreshCookie } = await loggedInUser(ADMIN); // success
    await http.post('/api/v1/auth/logout').set('Cookie', `cos_refresh=${refreshCookie}`);

    for (const action of ['auth.login.success', 'auth.login.failure', 'auth.logout']) {
      const entry = await prisma.auditLog.findFirst({
        where: { actorId: admin.id, action },
        orderBy: { createdAt: 'desc' },
      });
      expect(entry).not.toBeNull();
    }
  });
});
