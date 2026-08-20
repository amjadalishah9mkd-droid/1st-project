import { PrismaClient } from '@prisma/client';
import { runSystemSeed } from './system.seed';
import { runDemoSeed } from './demo.seed';

/**
 * Seed entrypoint (Blueprint §8).
 *  - System seed: always runs, idempotent.
 *  - Demo seed: only when SEED_DEMO=true (development/Alloy).
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const collegeId = await runSystemSeed(prisma);
    console.log('[seed] system seed complete');

    if (process.env.SEED_DEMO === 'true') {
      await runDemoSeed(prisma, collegeId);
      console.log('[seed] demo seed complete (3 demo users)');
    } else {
      console.log('[seed] demo seed skipped (SEED_DEMO != true)');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[seed] failed:', error);
  process.exit(1);
});
