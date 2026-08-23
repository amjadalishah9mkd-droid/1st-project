import { z } from 'zod';

/**
 * Auth schemas (Blueprint §9). Single validation source: the API validates
 * requests through these schemas via the Zod validation pipe, and the web
 * client validates forms with the same objects.
 */
export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Enter a valid email address')
    .max(254),
  password: z
    .string({ required_error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters')
    .max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(8).max(128),
    newPassword: z
      .string()
      .min(10, 'New password must be at least 10 characters')
      .max(128)
      .regex(/[a-z]/, 'Must include a lowercase letter')
      .regex(/[A-Z]/, 'Must include an uppercase letter')
      .regex(/[0-9]/, 'Must include a digit'),
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Invitation / reset acceptance (M10-W2). Same password policy. */
export const acceptInviteSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{64}$/, 'Invalid link'),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(128)
    .regex(/[a-z]/, 'Must include a lowercase letter')
    .regex(/[A-Z]/, 'Must include an uppercase letter')
    .regex(/[0-9]/, 'Must include a digit'),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

/** M12-W2 — self-service preferences (single email opt-out boolean, O3). */
export const updatePreferencesSchema = z
  .object({ emailOptOut: z.boolean() })
  .strict();
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

export interface CredentialLink {
  url: string; // path-only, e.g. /accept-invite?token=…
  expiresAt: string;
}
