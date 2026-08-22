/**
 * M10-W4 — production seed safety guard.
 *
 * Demo data (demo users with known passwords) must never be created in a
 * production environment by accident. The demo seed only runs in production
 * when the operator explicitly sets ALLOW_DEMO_SEED=true.
 */

export type DemoSeedDecision =
  | { action: 'run' }
  | { action: 'skip'; reason: string }
  | { action: 'refuse'; reason: string };

export interface SeedGuardEnv {
  NODE_ENV?: string;
  SEED_DEMO?: string;
  ALLOW_DEMO_SEED?: string;
}

export const PRODUCTION_REFUSAL_MESSAGE = [
  '!!! DEMO SEED REFUSED — PRODUCTION ENVIRONMENT DETECTED !!!',
  'SEED_DEMO=true was requested, but demo seeding is DISABLED when',
  'NODE_ENV=production. Demo accounts use publicly known passwords and',
  'must never be created in production by accident.',
  'If you REALLY intend to load demo data into this environment, re-run',
  'with the explicit override: ALLOW_DEMO_SEED=true',
  'The system seed (roles/permissions) is unaffected and has completed.',
].join('\n');

export function resolveDemoSeedDecision(env: SeedGuardEnv): DemoSeedDecision {
  if (env.SEED_DEMO !== 'true') {
    return { action: 'skip', reason: 'SEED_DEMO != true' };
  }
  if (env.NODE_ENV === 'production' && env.ALLOW_DEMO_SEED !== 'true') {
    return { action: 'refuse', reason: PRODUCTION_REFUSAL_MESSAGE };
  }
  return { action: 'run' };
}
