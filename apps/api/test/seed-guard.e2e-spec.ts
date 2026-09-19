import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import {
  PRODUCTION_REFUSAL_MESSAGE,
  resolveDemoSeedDecision,
} from '../prisma/seed/guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './test-app';
import type { INestApplication } from '@nestjs/common';

const exec = promisify(execFile);
const API_DIR = path.resolve(__dirname, '..');

/** Runs the real seed CLI with a controlled environment. */
async function runSeed(env: Record<string, string>) {
  const base: NodeJS.ProcessEnv = { ...process.env };
  delete base.NODE_ENV;
  delete base.SEED_DEMO;
  delete base.ALLOW_DEMO_SEED;
  const { stdout, stderr } = await exec(
    'npx',
    ['tsx', 'prisma/seed/index.ts'],
    {
      cwd: API_DIR,
      env: { ...base, ...env },
      timeout: 120_000,
    },
  );
  return stdout + stderr;
}

describe('M10-W4 — production seed safety guard', () => {
  describe('decision logic', () => {
    it('development + SEED_DEMO=true → run', () => {
      expect(
        resolveDemoSeedDecision({ NODE_ENV: 'development', SEED_DEMO: 'true' }),
      ).toEqual({ action: 'run' });
    });

    it('SEED_DEMO unset → skip (any environment)', () => {
      expect(resolveDemoSeedDecision({ NODE_ENV: 'development' }).action).toBe(
        'skip',
      );
      expect(resolveDemoSeedDecision({ NODE_ENV: 'production' }).action).toBe(
        'skip',
      );
    });

    it('production + SEED_DEMO=true without override → refuse loudly', () => {
      const decision = resolveDemoSeedDecision({
        NODE_ENV: 'production',
        SEED_DEMO: 'true',
      });
      expect(decision.action).toBe('refuse');
      expect(decision).toMatchObject({ reason: PRODUCTION_REFUSAL_MESSAGE });
      expect(PRODUCTION_REFUSAL_MESSAGE).toMatch(/PRODUCTION/);
      expect(PRODUCTION_REFUSAL_MESSAGE).toMatch(/ALLOW_DEMO_SEED=true/);
    });

    it('production + ALLOW_DEMO_SEED=false is still refused', () => {
      expect(
        resolveDemoSeedDecision({
          NODE_ENV: 'production',
          SEED_DEMO: 'true',
          ALLOW_DEMO_SEED: 'false',
        }).action,
      ).toBe('refuse');
    });

    it('production + explicit ALLOW_DEMO_SEED=true override → run', () => {
      expect(
        resolveDemoSeedDecision({
          NODE_ENV: 'production',
          SEED_DEMO: 'true',
          ALLOW_DEMO_SEED: 'true',
        }),
      ).toEqual({ action: 'run' });
    });
  });

  describe('seed CLI against the live database', () => {
    let app: INestApplication;
    let prisma: PrismaService;

    beforeAll(async () => {
      app = await createTestApp();
      prisma = app.get(PrismaService);
    });

    afterAll(async () => {
      await app.close();
    });

    async function demoUserCount(): Promise<number> {
      return prisma.user.count({
        where: {
          email: {
            in: [
              'admin@campusos.dev',
              'teacher@campusos.dev',
              'student@campusos.dev',
            ],
          },
        },
      });
    }

    it('production + SEED_DEMO=true refuses demo seed but system seed still completes', async () => {
      const before = await demoUserCount();
      const demoTotalBefore = await prisma.user.count();

      const output = await runSeed({
        NODE_ENV: 'production',
        SEED_DEMO: 'true',
      });

      expect(output).toContain('system seed complete');
      expect(output).toContain('DEMO SEED REFUSED');
      expect(output).toContain('ALLOW_DEMO_SEED=true');
      expect(output).toContain('demo seed REFUSED (production guard)');
      expect(output).not.toContain('demo seed complete');

      // No users created or modified counts-wise by the refused demo seed.
      expect(await demoUserCount()).toBe(before);
      expect(await prisma.user.count()).toBe(demoTotalBefore);
    }, 120_000);

    it('development + SEED_DEMO=true still runs the demo seed (idempotent)', async () => {
      const output = await runSeed({
        NODE_ENV: 'development',
        SEED_DEMO: 'true',
      });
      expect(output).toContain('system seed complete');
      expect(output).toContain('demo seed complete');
      expect(await demoUserCount()).toBe(3);
    }, 120_000);

    it('production + ALLOW_DEMO_SEED=true override runs the demo seed with a warning', async () => {
      const output = await runSeed({
        NODE_ENV: 'production',
        SEED_DEMO: 'true',
        ALLOW_DEMO_SEED: 'true',
      });
      expect(output).toContain('demo seed complete');
      expect(output).toContain('explicit ALLOW_DEMO_SEED=true override');
      expect(await demoUserCount()).toBe(3);
    }, 120_000);

    it('system seed alone (SEED_DEMO not requested) works in production mode', async () => {
      // Note: Prisma Client auto-loads apps/api/.env (which sets
      // SEED_DEMO=true for Alloy dev), so we explicitly disable it here to
      // model a production host without the demo flag.
      const output = await runSeed({
        NODE_ENV: 'production',
        SEED_DEMO: 'false',
      });
      expect(output).toContain('system seed complete');
      expect(output).toContain('demo seed skipped (SEED_DEMO != true)');
    }, 120_000);
  });
});
