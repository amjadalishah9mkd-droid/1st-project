import { z } from 'zod';

/**
 * M11 — Identity & Student Verification shared contracts (W1 foundation).
 *
 * Google `sub` is the immutable provider identity key; email is never an
 * identity key. Student uniqueness is anchored on
 * StudentProfile(collegeId, admissionNo) and enforced by partial unique
 * indexes on StudentIdentityClaim (see the m11_identity_foundation
 * migration).
 */

// ── Verification lifecycle (mirrors Prisma enums) ──────────────────────────

export const USER_VERIFICATION_STATUSES = [
  'LEGACY',
  'UNVERIFIED',
  'PENDING',
  'VERIFIED',
  'REJECTED',
] as const;
export type UserVerificationStatus = (typeof USER_VERIFICATION_STATUSES)[number];

export const CLAIM_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
export type ClaimStatusKey = (typeof CLAIM_STATUSES)[number];

export const AUTH_PROVIDERS = ['GOOGLE'] as const;
export type AuthProviderKey = (typeof AUTH_PROVIDERS)[number];

// ── College feature flag: Google authentication rollout mode (D2/D7) ───────
//
//   off      — M0–M10 behavior, Google endpoints disabled for this college
//   additive — Google login/linking available; student password login still works
//   required — students must use Google; password login refused for students

export const GOOGLE_AUTH_MODES = ['off', 'additive', 'required'] as const;
export type GoogleAuthMode = (typeof GOOGLE_AUTH_MODES)[number];

/** Evidence retention after claim approval (D5). */
export const EVIDENCE_RETENTION_DAYS = 30;

export const collegeSettingsSchema = z
  .object({
    googleAuth: z.enum(GOOGLE_AUTH_MODES).default('off'),
    /** Self-registration via Google (D2). Off by default per college. */
    allowSelfRegistration: z.boolean().default(false),
    /**
     * Grace period (days) announced before a college moves from `additive`
     * to `required` (D7). Informational for tooling/UI; the switch itself is
     * the explicit `googleAuth` value.
     */
    googleAuthGraceDays: z.number().int().min(0).max(365).default(30),
  })
  .passthrough(); // College.settings may hold other keys; never drop them.

export type CollegeSettings = z.infer<typeof collegeSettingsSchema>;

/** Parses College.settings JSON with safe defaults (never throws). */
export function readCollegeSettings(raw: unknown): CollegeSettings {
  const result = collegeSettingsSchema.safeParse(raw ?? {});
  return result.success ? result.data : collegeSettingsSchema.parse({});
}
