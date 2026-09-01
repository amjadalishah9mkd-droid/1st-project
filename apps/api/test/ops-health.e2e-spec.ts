import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M19-W3 — deep operational health (GET /health/ops).
 * Internal-only V1: settings.manage gate, db/migration state, backup
 * freshness from the server-configured BACKUP_DIR, no sensitive output.
 */
describe('M19-W3 — /health/ops', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let adminToken: string;
  let studentToken: string;
  let backupDir: string;
  const originalBackupDir = process.env.BACKUP_DIR;

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    backupDir = await mkdtemp(join(tmpdir(), 'campusos-ops-'));
    app = await createTestApp();
    http = request(app.getHttpServer());
    adminToken = await login('admin@campusos.dev');
    studentToken = await login('student@campusos.dev');
  });

  afterAll(async () => {
    process.env.BACKUP_DIR = originalBackupDir;
    if (originalBackupDir === undefined) delete process.env.BACKUP_DIR;
    await rm(backupDir, { recursive: true, force: true });
    await app.close();
  });

  const ops = (token?: string) =>
    token
      ? http.get('/api/v1/health/ops').set({ Authorization: `Bearer ${token}` })
      : http.get('/api/v1/health/ops');

  it('requires authentication and settings.manage (student 403, anon 401)', async () => {
    expect((await ops()).status).toBe(401);
    const forbidden = await ops(studentToken);
    expect(forbidden.status).toBe(403);
  });

  it('reports db up and a clean migration ledger for the admin', async () => {
    delete process.env.BACKUP_DIR;
    const res = await ops(adminToken);
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.database).toBe('up');
    expect(data.migrations.status).toBe('ok');
    expect(data.migrations.applied).toBeGreaterThanOrEqual(13);
    expect(data.migrations.unfinished).toBe(0);
    expect(data.backups).toEqual({
      configured: false,
      count: 0,
      latestAgeSeconds: null,
      stale: false,
    });
    expect(data.uploadsWritable).toBe(true);
    expect(data.status).toBe('ok');
    expect(typeof data.uptimeSeconds).toBe('number');
    expect(data.runtime.scope).toBe('instance');
    expect(typeof data.runtime.resetAt).toBe('string');
  });

  it('reports fresh backups as healthy', async () => {
    process.env.BACKUP_DIR = backupDir;
    await writeFile(join(backupDir, 'campusos-20260828T000000Z.dump'), 'x');
    await writeFile(
      join(backupDir, 'campusos-uploads-20260828T000000Z.tar.gz'),
      'x',
    );
    await writeFile(
      join(backupDir, '.backup-health'),
      String(Math.floor(Date.now() / 1000)),
    );
    // In-progress partial files must not count.
    await writeFile(join(backupDir, '.campusos-x.dump.partial'), 'x');
    const res = await ops(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.backups.configured).toBe(true);
    expect(res.body.data.backups.count).toBe(1);
    expect(res.body.data.backups.latestAgeSeconds).toBeLessThan(120);
    expect(res.body.data.backups.stale).toBe(false);
    expect(res.body.data.status).toBe('ok');
  });

  it('flags stale backups and degrades overall status', async () => {
    process.env.BACKUP_DIR = backupDir;
    const old = Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60;
    await writeFile(join(backupDir, '.backup-health'), String(old));
    const res = await ops(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.backups.stale).toBe(true);
    expect(res.body.data.status).toBe('degraded');
  });

  it('flags a configured-but-missing backup directory as stale', async () => {
    process.env.BACKUP_DIR = join(backupDir, 'does-not-exist');
    const res = await ops(adminToken);
    expect(res.body.data.backups).toEqual({
      configured: true,
      count: 0,
      latestAgeSeconds: null,
      stale: true,
    });
    expect(res.body.data.status).toBe('degraded');
  });

  it('does not accept a fresh DB dump without its paired uploads archive', async () => {
    const incomplete = await mkdtemp(join(tmpdir(), 'campusos-incomplete-'));
    try {
      process.env.BACKUP_DIR = incomplete;
      await writeFile(
        join(incomplete, 'campusos-20260828T000001Z.dump'),
        'db-only',
      );
      await writeFile(
        join(incomplete, '.backup-health'),
        String(Math.floor(Date.now() / 1000)),
      );
      const res = await ops(adminToken);
      expect(res.body.data.backups).toMatchObject({
        configured: true,
        count: 0,
        stale: true,
      });
      expect(res.body.data.status).toBe('degraded');
    } finally {
      await rm(incomplete, { recursive: true, force: true });
    }
  });

  it('never leaks paths, filenames, DSNs or credentials', async () => {
    process.env.BACKUP_DIR = backupDir;
    const res = await ops(adminToken);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(backupDir);
    expect(body).not.toContain('campusos-20260828T000000Z');
    expect(body).not.toContain('postgresql://');
    expect(body).not.toContain(process.env.DATABASE_URL ?? 'postgresql://');
  });
});
