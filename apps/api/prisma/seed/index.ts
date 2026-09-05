import { PrismaClient } from '@prisma/client';
import { runSystemSeed } from './system.seed';
import { runDemoSeed } from './demo.seed';
import { resolveDemoSeedDecision } from './guard';

/**
 * Seed entrypoint (Blueprint §8).
 *  - System seed: always runs, idempotent, safe in every environment.
 *  - Demo seed: only when SEED_DEMO=true (development/Alloy). In production
 *    it is refused unless ALLOW_DEMO_SEED=true is set explicitly (M10-W4).
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const collegeId = await runSystemSeed(prisma);
    console.log('[seed] system seed complete');

    const decision = resolveDemoSeedDecision(process.env);
    switch (decision.action) {
      case 'run':
        await runDemoSeed(prisma, collegeId);
        if (process.env.NODE_ENV === 'production') {
          console.warn(
            '[seed] WARNING: demo seed ran in production via explicit ALLOW_DEMO_SEED=true override',
          );
        }
        console.log('[seed] demo seed complete (3 demo users)');
        break;
      case 'refuse':
        console.error(decision.reason);
        console.error('[seed] demo seed REFUSED (production guard)');
        break;
      case 'skip':
        console.log(`[seed] demo seed skipped (${decision.reason})`);
        break;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[seed] failed:', error);
  process.exit(1);
});
