import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { PaginationQuery, PageMeta } from '@campusos/shared';
import { pageArgs, pageMeta } from '../common/pagination/pagination';
import type { AuthenticatedUser } from '../access/authenticated-user';

export interface AuditRowPayload {
  id: string;
  action: string;
  createdAt: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  actor: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
  } | null;
}

export interface AuditListQuery extends PaginationQuery {
  action?: string;
  actorId?: string;
  from?: string;
  to?: string;
}

export interface AuditEntry {
  collegeId: string;
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * AuditService (Blueprint §6/§9).
 * Fire-and-forget writes: an audit failure must never fail the business
 * operation, but it is always logged.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          collegeId: entry.collegeId,
          actorId: entry.actorId ?? null,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          metadata: (entry.metadata ?? {}) as object,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit entry ${entry.action}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * M12-W4 — read-only, tenant-scoped audit listing (audit.read).
   * Newest first (rides the [collegeId, createdAt] index). Filters:
   * action prefix, actorId, inclusive from/to date window, and `q`
   * matching action substring or exact targetId.
   */
  async list(
    user: AuthenticatedUser,
    query: AuditListQuery,
  ): Promise<{ data: AuditRowPayload[]; meta: PageMeta }> {
    const where = {
      collegeId: user.collegeId, // tenancy — always
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { action: { contains: query.q, mode: 'insensitive' as const } },
              { targetId: query.q },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(query),
        include: {
          actor: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
            },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        action: row.action,
        createdAt: row.createdAt.toISOString(),
        targetType: row.targetType,
        targetId: row.targetId,
        metadata: row.metadata,
        actor: row.actor,
      })),
      meta: pageMeta(query, total),
    };
  }
}
