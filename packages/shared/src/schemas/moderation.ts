import { z } from 'zod';

/** Moderation, notification & announcement schemas (M8). */

export const createReportSchema = z.object({
  targetType: z.enum(['POST', 'COMMENT', 'USER', 'EVENT', 'RESOURCE']),
  targetId: z.string().min(1),
  reason: z.enum([
    'SPAM',
    'HARASSMENT',
    'INAPPROPRIATE',
    'MISINFORMATION',
    'OTHER',
  ]),
  details: z.string().trim().max(1000).optional(),
});
export type CreateReportInput = z.infer<typeof createReportSchema>;

export const resolveReportSchema = z.object({
  status: z.enum(['REVIEWING', 'RESOLVED', 'DISMISSED']),
  resolutionNote: z.string().trim().max(1000).optional(),
});
export type ResolveReportInput = z.infer<typeof resolveReportSchema>;

export const moderationActionSchema = z
  .object({
    reportId: z.string().min(1).optional(),
    action: z.enum([
      'REMOVE_CONTENT',
      'RESTORE_CONTENT',
      'WARN_USER',
      'SUSPEND_COMMUNITY',
      'LIFT_SUSPENSION',
    ]),
    targetType: z.enum(['POST', 'COMMENT', 'USER', 'EVENT', 'RESOURCE']),
    targetId: z.string().min(1),
    targetUserId: z.string().min(1).optional(),
    expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .refine(
    (data) =>
      !['WARN_USER', 'SUSPEND_COMMUNITY', 'LIFT_SUSPENSION'].includes(
        data.action,
      ) ||
      data.targetUserId !== undefined ||
      data.targetType !== 'USER',
    { message: 'targetUserId is required for user-level actions', path: ['targetUserId'] },
  );
export type ModerationActionInput = z.infer<typeof moderationActionSchema>;

export const createAnnouncementSchema = z
  .object({
    title: z.string().trim().min(3, 'Title is required').max(160),
    body: z.string().trim().min(1, 'Body is required').max(5000),
    audienceScope: z.enum(['ALL', 'ROLE', 'DEPARTMENT', 'SECTION']),
    audienceIds: z.array(z.string().min(1)).max(50).default([]),
  })
  .refine(
    (data) => data.audienceScope === 'ALL' || data.audienceIds.length > 0,
    {
      message: 'Choose at least one audience target',
      path: ['audienceIds'],
    },
  );
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;

export const notificationsQuerySchema = z.object({
  unread: z.enum(['true', 'false']).optional(),
});
