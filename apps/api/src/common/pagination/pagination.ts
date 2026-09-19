import type { PageMeta, PaginationQuery } from '@campusos/shared';

/** Offset pagination helpers (Blueprint §7 list conventions). */
export function pageArgs(query: PaginationQuery): {
  skip: number;
  take: number;
} {
  return { skip: (query.page - 1) * query.limit, take: query.limit };
}

export function pageMeta(query: PaginationQuery, total: number): PageMeta {
  return {
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}
