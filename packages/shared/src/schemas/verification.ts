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
    /**
     * M21-W2 (O-6) — attendance percentage below which a student is
     * flagged on read-only attendance surfaces. Display-only V1: it never
     * changes attendance calculations, records or notifications.
     */
    attendanceWarningThreshold: z.number().int().min(0).max(100).default(75),
  })
  .passthrough(); // College.settings may hold other keys — never drop them.
// NOTE (M21-W2, O-5): `locale` is a RESERVED settings key. It is preserved
// verbatim by the passthrough above but deliberately has no schema field,
// no UI and no runtime behavior — internationalization is future work.

export type CollegeSettings = z.infer<typeof collegeSettingsSchema>;

/** Parses College.settings JSON with safe defaults (never throws). */
export function readCollegeSettings(raw: unknown): CollegeSettings {
  const result = collegeSettingsSchema.safeParse(raw ?? {});
  return result.success ? result.data : collegeSettingsSchema.parse({});
}

// ── M11-W3: claims API contracts ────────────────────────────────────────────

export const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB — ID card images
export const EVIDENCE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export const submitClaimSchema = z.object({
  claimedAdmissionNo: z.string().trim().min(1).max(64),
  evidenceFileKey: z.string().trim().min(1).max(200),
});
export type SubmitClaimInput = z.infer<typeof submitClaimSchema>;

export const claimDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    rejectionReason: z.string().trim().min(3).max(500).optional(),
  })
  .refine((v) => v.decision !== 'REJECT' || v.rejectionReason, {
    message: 'A rejection reason is required',
    path: ['rejectionReason'],
  });
export type ClaimDecisionInput = z.infer<typeof claimDecisionSchema>;

/** Own-claim view (student). Never exposes reviewer identity. */
export interface MyClaimItem {
  id: string;
  claimedAdmissionNo: string;
  status: ClaimStatusKey;
  createdAt: string;
  decidedAt: string | null;
  rejectionReason: string | null;
  evidence: { name: string; size: number } | null;
}

/** Admin queue/detail view. */
export interface ClaimAdminItem {
  id: string;
  status: ClaimStatusKey;
  claimedAdmissionNo: string;
  createdAt: string;
  decidedAt: string | null;
  rejectionReason: string | null;
  claimant: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    verificationStatus: UserVerificationStatus;
  };
  matchedProfile: {
    id: string;
    admissionNo: string;
    rollNo: string;
    batch: string;
    firstName: string;
    lastName: string;
    departmentName: string;
    belongsToClaimant: boolean;
  } | null;
  evidence: { url: string; name: string; size: number; mimeType: string } | null;
}
