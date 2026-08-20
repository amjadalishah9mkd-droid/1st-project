import { z } from 'zod';

/** Shared pagination/query schemas (Blueprint §7 list conventions). */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  sort: z.string().trim().max(100).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const idParamSchema = z.object({
  id: z.string().min(1),
});
