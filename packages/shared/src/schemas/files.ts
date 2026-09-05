import { z } from 'zod';

/** File URL signing (M10-W1). */
export const signFileUrlSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'File URL is required')
    .max(600)
    // Internal, relative CampusOS file URLs only — no scheme, no host.
    .regex(
      /^\/api\/v1\/files\/[^/\\?#]+$/,
      'Only CampusOS file URLs can be signed',
    ),
});
export type SignFileUrlInput = z.infer<typeof signFileUrlSchema>;

export interface SignedFileUrl {
  url: string;
  expiresAt: string;
}
