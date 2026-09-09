import { z } from 'zod';

/** Community schemas (M7). Single validation source. */
const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date/time');

export const createPostSchema = z.object({
  type: z
    .enum(['GENERAL', 'RESOURCE', 'ACHIEVEMENT', 'EVENT_SHARE'])
    .default('GENERAL'),
  body: z.string().trim().min(1, 'Write something first').max(5000),
  groupId: z.string().min(1).optional(),
  societyId: z.string().min(1).optional(),
  resourceId: z.string().min(1).optional(),
  eventId: z.string().min(1).optional(),
});
export type CreatePostInput = z.infer<typeof createPostSchema>;

export const updatePostSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});
export type UpdatePostInput = z.infer<typeof updatePostSchema>;

export const createCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(2000),
  parentId: z.string().min(1).optional(),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const createGroupSchema = z.object({
  name: z.string().trim().min(3, 'Name is required').max(80),
  description: z.string().trim().min(1, 'Description is required').max(1000),
  privacy: z.enum(['OPEN', 'REQUEST']).default('OPEN'),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = createGroupSchema.partial();
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

export const createSocietySchema = z.object({
  name: z.string().trim().min(3, 'Name is required').max(80),
  category: z.enum([
    'TECHNICAL',
    'CULTURAL',
    'SPORTS',
    'LITERARY',
    'SOCIAL',
    'OTHER',
  ]),
  description: z.string().trim().min(1, 'Description is required').max(1000),
  facultyAdvisorId: z.string().min(1).optional().nullable(),
});
export type CreateSocietyInput = z.infer<typeof createSocietySchema>;

export const updateSocietySchema = createSocietySchema.partial().extend({
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});
export type UpdateSocietyInput = z.infer<typeof updateSocietySchema>;

export const societyMemberSchema = z.object({
  userId: z.string().min(1, 'Member is required'),
  role: z.enum(['MEMBER', 'OFFICER', 'PRESIDENT']).default('MEMBER'),
});
export type SocietyMemberInput = z.infer<typeof societyMemberSchema>;

export const createEventSchema = z
  .object({
    societyId: z.string().min(1).optional(), // absent = campus-wide
    title: z.string().trim().min(3, 'Title is required').max(140),
    description: z.string().trim().min(1, 'Description is required').max(3000),
    venue: z.string().trim().min(1, 'Venue is required').max(120),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    capacity: z.coerce.number().int().positive().max(100000).optional(),
  })
  .refine((data) => new Date(data.startsAt) < new Date(data.endsAt), {
    message: 'End must be after the start',
    path: ['endsAt'],
  });
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = z.object({
  title: z.string().trim().min(3).max(140).optional(),
  description: z.string().trim().min(1).max(3000).optional(),
  venue: z.string().trim().min(1).max(120).optional(),
  startsAt: isoDateTime.optional(),
  endsAt: isoDateTime.optional(),
  capacity: z.coerce.number().int().positive().max(100000).optional(),
  status: z.enum(['ACTIVE', 'CANCELLED']).optional(),
});
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const rsvpSchema = z.object({
  status: z.enum(['GOING', 'INTERESTED', 'DECLINED']),
});
export type RsvpInput = z.infer<typeof rsvpSchema>;

export const createResourceSchema = z.object({
  title: z.string().trim().min(3, 'Title is required').max(140),
  description: z.string().trim().max(1000).optional(),
  courseId: z.string().min(1).optional(),
  fileUrl: z.string().trim().min(1, 'Upload a file first').max(500),
  fileName: z.string().trim().min(1).max(255),
  fileType: z.string().trim().max(100).default('application/octet-stream'),
  fileSize: z.coerce.number().int().min(0),
});
export type CreateResourceInput = z.infer<typeof createResourceSchema>;
