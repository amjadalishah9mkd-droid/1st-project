import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/** M22-W3 — sidecar marker health is deterministic and secret-free. */
describe('M22-W3 — backup sidecar healthcheck', () => {
  let dir: string;
  const script = resolve(__dirname, '../../../scripts/backup/backup-healthcheck.sh');

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'campusos-backup-health-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function run(maxAge = 60) {
    return spawnSync('bash', [script], {
      env: {
        ...process.env,
        BACKUP_DIR: dir,
        BACKUP_HEALTH_FILE: join(dir, '.backup-health'),
        BACKUP_MAX_AGE_SECONDS: String(maxAge),
      },
      encoding: 'utf8',
    });
  }

  it('is unhealthy before any complete backup cycle', () => {
    const result = run();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(''); // no paths/credentials leaked
  });

  it('rejects malformed and future markers', async () => {
    const marker = join(dir, '.backup-health');
    await writeFile(marker, 'attacker-controlled-not-a-time');
    expect(run().status).not.toBe(0);
    await writeFile(marker, String(Math.floor(Date.now() / 1000) + 60));
    expect(run().status).not.toBe(0);
  });

  it('rejects stale markers', async () => {
    await writeFile(
      join(dir, '.backup-health'),
      String(Math.floor(Date.now() / 1000) - 120),
    );
    expect(run(60).status).not.toBe(0);
  });

  it('accepts a recent successful-cycle marker', async () => {
    await writeFile(
      join(dir, '.backup-health'),
      String(Math.floor(Date.now() / 1000)),
    );
    expect(run().status).toBe(0);
  });
});
