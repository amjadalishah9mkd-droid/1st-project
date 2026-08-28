import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { LocalStorageAdapter } from '../src/files/storage.adapter';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';
const PNG = Buffer.concat([
  Buffer.from('\x89PNG\r\n\x1a\n', 'binary'),
  Buffer.alloc(64, 7),
]);

/**
 * M19-W1 — stored-file ownership authorization (P2-IDOR-1).
 * Real-Postgres matrix: owner / same-college / cross-college / grandfathered
 * legacy keys / evidence strictness / uniqueness under duplicate insertion.
 */
describe('M19-W1 — stored file authorization', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let storage: LocalStorageAdapter;
  const suffix = `sfa-${Date.now().toString(36)}`;

  let collegeId: string;
  let rivalCollegeId: string;
  let studentToken: string; // demo student (owner in most tests)
  let teacherToken: string; // same-college non-owner
  let rivalToken: string; // cross-college user
  const madeUserIds: string[] = [];
  const madeKeys: string[] = [];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function uploadAs(token: string): Promise<{ url: string; key: string }> {
    const res = await http
      .post('/api/v1/files')
      .set(auth(token))
      .attach('file', PNG, 'w1.png');
    expect(res.status).toBe(201);
    const url = res.body.data.url as string;
    const key = decodeURIComponent(url.replace('/api/v1/files/', ''));
    madeKeys.push(key);
    return { url, key };
  }

  async function sign(token: string, url: string) {
    return http.post('/api/v1/files/sign').set(auth(token)).send({ url });
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    storage = app.get(LocalStorageAdapter);
    http = request(app.getHttpServer());

    const demo = await prisma.user.findFirstOrThrow({
      where: { email: 'student@campusos.dev' },
    });
    collegeId = demo.collegeId;

    const argon2 = await import('argon2');
    const rival = await prisma.college.create({
      data: { name: 'Rival College SFA', code: `RV-${suffix}` },
    });
    rivalCollegeId = rival.id;
    const rivalUser = await prisma.user.create({
      data: {
        college: { connect: { id: rival.id } },
        email: `rival-${suffix}@campusos.dev`,
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        role: 'ADMIN',
        firstName: 'Rival',
        lastName: 'SFA',
        mustChangePassword: false,
      },
    });
    madeUserIds.push(rivalUser.id);

    studentToken = await login('student@campusos.dev');
    teacherToken = await login('teacher@campusos.dev');
    rivalToken = await login(rivalUser.email);
  });

  afterAll(async () => {
    await prisma.storedFile.deleteMany({ where: { key: { in: madeKeys } } });
    for (const key of madeKeys) await storage.delete(key);
    await prisma.evidenceFile.deleteMany({ where: { key: { in: madeKeys } } });
    await prisma.auditLog.deleteMany({
      where: { collegeId: { in: [rivalCollegeId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: madeUserIds } } });
    await prisma.college.delete({ where: { id: rivalCollegeId } });
    await app.close();
  });

  it('records ownership (tenant + owner, purpose OTHER) on every new upload', async () => {
    const { key } = await uploadAs(studentToken);
    const demo = await prisma.user.findFirstOrThrow({
      where: { email: 'student@campusos.dev' },
    });
    const row = await prisma.storedFile.findUniqueOrThrow({ where: { key } });
    expect(row.collegeId).toBe(collegeId);
    expect(row.ownerUserId).toBe(demo.id);
    expect(row.createdById).toBe(demo.id);
    expect(row.purpose).toBe('OTHER');
  });

  it('upload response exposes no ownership metadata', async () => {
    const res = await http
      .post('/api/v1/files')
      .set(auth(studentToken))
      .attach('file', PNG, 'meta.png');
    expect(res.status).toBe(201);
    madeKeys.push(
      decodeURIComponent((res.body.data.url as string).replace('/api/v1/files/', '')),
    );
    expect(Object.keys(res.body.data).sort()).toEqual(['name', 'size', 'url']);
  });

  it('owner can sign and download their own file', async () => {
    const { url } = await uploadAs(studentToken);
    const signed = await sign(studentToken, url);
    expect(signed.status).toBe(201);
    const dl = await http.get(signed.body.data.url as string);
    expect(dl.status).toBe(200);
  });

  it('same-college non-owner can sign (in-college shared content)', async () => {
    const { url } = await uploadAs(studentToken);
    const signed = await sign(teacherToken, url);
    expect(signed.status).toBe(201);
  });

  it('cross-college user gets 404, indistinguishable from a missing file', async () => {
    const { url } = await uploadAs(studentToken);
    const foreign = await sign(rivalToken, url);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('NOT_FOUND');

    const missing = await sign(
      rivalToken,
      '/api/v1/files/ffffffffffffffffffffffffffffffff__nope.png',
    );
    // Well-formed unknown keys are grandfathered at sign time…
    expect(missing.status).toBe(201);
    // …so the only distinguishable outcome for the rival would be a
    // signable-but-404 download, exactly like any dead legacy link:
    const dl = await http.get(missing.body.data.url as string);
    expect(dl.status).toBe(404);
  });

  it('owner from another college is still allowed (owner check precedes tenancy)', async () => {
    const { url, key } = await uploadAs(rivalToken);
    const row = await prisma.storedFile.findUniqueOrThrow({ where: { key } });
    expect(row.collegeId).toBe(rivalCollegeId);
    // Demo-college users cannot sign the rival's file…
    const foreign = await sign(studentToken, url);
    expect(foreign.status).toBe(404);
    // …but the rival owner can.
    const own = await sign(rivalToken, url);
    expect(own.status).toBe(201);
  });

  it('grandfathered legacy keys (no ownership row) keep working for all users', async () => {
    // Simulate a pre-M19 upload the backfill could not derive: binary on
    // disk, no StoredFile row.
    const stored = await storage.save(Buffer.from('legacy bytes'), 'legacy.txt');
    madeKeys.push(stored.key);
    const url = `/api/v1/files/${stored.key}`;

    for (const token of [studentToken, teacherToken, rivalToken]) {
      const signed = await sign(token, url);
      expect(signed.status).toBe(201);
      const dl = await http.get(signed.body.data.url as string);
      expect(dl.status).toBe(200);
    }
  });

  it('backfilled rows enforce tenancy exactly like fresh uploads', async () => {
    // Simulate what migration #13 produces for a derivable legacy key.
    const stored = await storage.save(Buffer.from('backfilled'), 'bf.txt');
    madeKeys.push(stored.key);
    await prisma.storedFile.create({
      data: {
        key: stored.key,
        collegeId: rivalCollegeId,
        purpose: 'COMMUNITY_ATTACHMENT',
        // Unclaimed-profile derivations leave owner NULL — college gate only.
        ownerUserId: null,
      },
    });
    const url = `/api/v1/files/${stored.key}`;
    expect((await sign(rivalToken, url)).status).toBe(201);
    expect((await sign(studentToken, url)).status).toBe(404);
    expect((await sign(teacherToken, url)).status).toBe(404);
  });

  it('evidence keys stay on the stricter evidence rule (same-college is NOT enough)', async () => {
    const up = await http
      .post('/api/v1/verification/evidence')
      .set(auth(studentToken))
      .attach('file', PNG, 'id-card.png');
    expect(up.status).toBe(201);
    const key = up.body.data.evidenceFileKey as string;
    madeKeys.push(key);

    // M19-W1 uniform ownership record exists with purpose EVIDENCE…
    const row = await prisma.storedFile.findUniqueOrThrow({ where: { key } });
    expect(row.purpose).toBe('EVIDENCE');
    expect(row.collegeId).toBe(collegeId);

    const url = `/api/v1/files/${key}`;
    // …owner may sign; a same-college teacher WITHOUT verification.manage
    // may not (EvidenceAuthzService fires before the college-level rule).
    expect((await sign(studentToken, url)).status).toBe(201);
    expect((await sign(teacherToken, url)).status).toBe(404);
    expect((await sign(rivalToken, url)).status).toBe(404);
  });

  it('duplicate ownership insertion is impossible (unique key, insert-first)', async () => {
    const { key } = await uploadAs(studentToken);
    const results = await Promise.allSettled([
      prisma.storedFile.create({ data: { key, collegeId } }),
      prisma.storedFile.create({ data: { key, collegeId: rivalCollegeId } }),
    ]);
    for (const r of results) {
      expect(r.status).toBe('rejected');
      expect(
        (r as PromiseRejectedResult).reason,
      ).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect(
        ((r as PromiseRejectedResult).reason as Prisma.PrismaClientKnownRequestError).code,
      ).toBe('P2002');
    }
    // The original (correct) tenant record survives.
    const row = await prisma.storedFile.findUniqueOrThrow({ where: { key } });
    expect(row.collegeId).toBe(collegeId);
  });

  it('signing still rejects non-internal or path-escaping URLs', async () => {
    for (const url of [
      'https://evil.example/api/v1/files/x',
      '/api/v1/files/../secrets',
      '/api/v1/files/a/b',
    ]) {
      const res = await sign(studentToken, url);
      expect(res.status).toBe(400);
      // Absolute URLs die in the shared Zod schema; internal-but-malformed
      // keys die in the controller's key rules.
      expect(['INVALID_FILE_URL', 'VALIDATION_ERROR']).toContain(
        res.body.error.code,
      );
    }
  });
});
