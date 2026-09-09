import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { readCollegeSettings } from '@campusos/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M11-W1 — identity foundation.
 * Verifies the database-level duplicate-prevention invariants (partial
 * unique indexes), the AuthIdentity uniqueness guarantees, nullable
 * passwordHash fail-closed behavior, permission seeding, and that
 * googleAuth=off produces zero behavioral change.
 */
describe('M11-W1 — identity & verification foundation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let collegeId: string;
  let departmentId: string;
  const suffix = Date.now().toString(36);
  const madeUsers: string[] = [];
  const madeProfiles: string[] = [];

  async function makeUser(tag: string, passwordHash: string | null = null) {
    const user = await prisma.user.create({
      data: {
        college: { connect: { id: collegeId } },
        email: `w1-${tag}-${suffix}@campusos.dev`,
        passwordHash,
        role: 'STUDENT',
        firstName: 'W1',
        lastName: tag,
        mustChangePassword: false,
      },
    });
    madeUsers.push(user.id);
    return user;
  }

  async function makeProfile(tag: string) {
    const user = await makeUser(`p-${tag}`);
    const profile = await prisma.studentProfile.create({
      data: {
        user: { connect: { id: user.id } },
        college: { connect: { id: collegeId } },
        department: { connect: { id: departmentId } },
        admissionNo: `W1-${tag}-${suffix}`,
        rollNo: `W1R-${tag}-${suffix}`,
        batch: '2026',
      },
    });
    madeProfiles.push(profile.id);
    return profile;
  }

  function claimInput(userId: string, studentProfileId: string | null) {
    return {
      collegeId,
      userId,
      studentProfileId,
      claimedAdmissionNo: `W1-claimed-${suffix}`,
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    app.get(LoginRateLimiterService).reset();
    http = request(app.getHttpServer());

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
    const department = await prisma.department.create({
      data: {
        college: { connect: { id: collegeId } },
        code: `W1D-${suffix}`,
        name: 'W1 Identity Dept',
      },
    });
    departmentId = department.id;
  });

  afterAll(async () => {
    await prisma.studentIdentityClaim.deleteMany({
      where: { userId: { in: madeUsers } },
    });
    await prisma.authIdentity.deleteMany({ where: { userId: { in: madeUsers } } });
    await prisma.studentProfile.deleteMany({ where: { id: { in: madeProfiles } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: madeUsers } } });
    await prisma.user.deleteMany({ where: { id: { in: madeUsers } } });
    await prisma.department.delete({ where: { id: departmentId } });
    await app.close();
  });

  describe('partial unique: one live claim per student identity', () => {
    it('rejects a second PENDING claim on the same profile', async () => {
      const profile = await makeProfile('dup');
      const u1 = await makeUser('dup1');
      const u2 = await makeUser('dup2');

      await prisma.studentIdentityClaim.create({
        data: claimInput(u1.id, profile.id),
      });
      await expect(
        prisma.studentIdentityClaim.create({
          data: claimInput(u2.id, profile.id),
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('an APPROVED claim still holds the slot; REJECTED frees it', async () => {
      const profile = await makeProfile('slot');
      const u1 = await makeUser('slot1');
      const u2 = await makeUser('slot2');

      const first = await prisma.studentIdentityClaim.create({
        data: claimInput(u1.id, profile.id),
      });
      await prisma.studentIdentityClaim.update({
        where: { id: first.id },
        data: { status: 'APPROVED', decidedAt: new Date() },
      });

      await expect(
        prisma.studentIdentityClaim.create({
          data: claimInput(u2.id, profile.id),
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      await prisma.studentIdentityClaim.update({
        where: { id: first.id },
        data: { status: 'REJECTED' },
      });
      const second = await prisma.studentIdentityClaim.create({
        data: claimInput(u2.id, profile.id),
      });
      expect(second.status).toBe('PENDING');
    });

    it('serializes concurrent duplicate claims: exactly one wins', async () => {
      const profile = await makeProfile('race');
      const users = await Promise.all(
        Array.from({ length: 5 }, (_, i) => makeUser(`race${i}`)),
      );

      const results = await Promise.allSettled(
        users.map((u) =>
          prisma.studentIdentityClaim.create({
            data: claimInput(u.id, profile.id),
          }),
        ),
      );
      const wins = results.filter((r) => r.status === 'fulfilled');
      const losses = results.filter(
        (r) =>
          r.status === 'rejected' &&
          (r.reason as { code?: string }).code === 'P2002',
      );
      expect(wins).toHaveLength(1);
      expect(losses).toHaveLength(4);
    });
  });

  describe('partial unique: one in-flight claim per claimant', () => {
    it('rejects a second PENDING claim by the same user', async () => {
      const p1 = await makeProfile('mine1');
      const p2 = await makeProfile('mine2');
      const user = await makeUser('claimant');

      const first = await prisma.studentIdentityClaim.create({
        data: claimInput(user.id, p1.id),
      });
      await expect(
        prisma.studentIdentityClaim.create({
          data: claimInput(user.id, p2.id),
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      // Cancelling frees the claimant to submit again.
      await prisma.studentIdentityClaim.update({
        where: { id: first.id },
        data: { status: 'CANCELLED' },
      });
      const again = await prisma.studentIdentityClaim.create({
        data: claimInput(user.id, p2.id),
      });
      expect(again.status).toBe('PENDING');
    });
  });

  describe('AuthIdentity uniqueness', () => {
    it('a provider sub can be linked to exactly one user, globally', async () => {
      const u1 = await makeUser('gid1');
      const u2 = await makeUser('gid2');
      const sub = `google-sub-${suffix}`;

      await prisma.authIdentity.create({
        data: {
          userId: u1.id,
          provider: 'GOOGLE',
          providerSub: sub,
          emailAtLink: u1.email,
        },
      });
      await expect(
        prisma.authIdentity.create({
          data: {
            userId: u2.id,
            provider: 'GOOGLE',
            providerSub: sub,
            emailAtLink: u2.email,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('a user can hold at most one identity per provider', async () => {
      const user = await makeUser('single');
      await prisma.authIdentity.create({
        data: {
          userId: user.id,
          provider: 'GOOGLE',
          providerSub: `sub-a-${suffix}`,
          emailAtLink: user.email,
        },
      });
      await expect(
        prisma.authIdentity.create({
          data: {
            userId: user.id,
            provider: 'GOOGLE',
            providerSub: `sub-b-${suffix}`,
            emailAtLink: user.email,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  describe('nullable passwordHash fails closed', () => {
    it('a password-less user cannot log in with any password', async () => {
      const user = await makeUser('nopass', null);
      app.get(LoginRateLimiterService).reset();
      const res = await http
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'AnyPassword123x' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBeDefined();
    });
  });

  describe('foundation wiring', () => {
    it('existing users defaulted to LEGACY verification status', async () => {
      const demo = await prisma.user.findFirstOrThrow({
        where: { email: 'student@campusos.dev' },
      });
      expect(demo.verificationStatus).toBe('LEGACY');
    });

    it('verification permissions are seeded with the correct grants', async () => {
      const grants = await prisma.rolePermission.findMany({
        where: { permission: { key: { startsWith: 'verification.' } } },
        include: { permission: true },
      });
      const shaped = grants.map((g) => ({
        role: g.role,
        key: g.permission.key,
        scope: g.scope,
      }));
      expect(shaped).toEqual(
        expect.arrayContaining([
          { role: 'ADMIN', key: 'verification.manage', scope: 'ALL' },
          { role: 'STUDENT', key: 'verification.submit', scope: 'OWN' },
        ]),
      );
      expect(shaped).toHaveLength(2);
    });

    it('college settings parse with googleAuth=off defaults', () => {
      expect(readCollegeSettings(undefined)).toMatchObject({
        googleAuth: 'off',
        allowSelfRegistration: false,
        googleAuthGraceDays: 30,
      });
      expect(readCollegeSettings({ theme: 'dark' })).toMatchObject({
        googleAuth: 'off',
        theme: 'dark',
      });
      expect(
        readCollegeSettings({ googleAuth: 'bogus' }).googleAuth,
      ).toBe('off');
    });

    it('googleAuth=off: demo password logins behave exactly as before', async () => {
      app.get(LoginRateLimiterService).reset();
      for (const email of [
        'admin@campusos.dev',
        'teacher@campusos.dev',
        'student@campusos.dev',
      ]) {
        const res = await http
          .post('/api/v1/auth/login')
          .send({ email, password: DEMO_PASSWORD });
        expect(res.status).toBe(200);
        expect(res.body.data.accessToken).toBeDefined();
      }
    });
  });
});
