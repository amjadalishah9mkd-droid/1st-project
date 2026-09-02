import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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

  /**
   * M17-W1: an optional transaction client makes the audit row part of
   * the caller's atomic transition (used by term lifecycle) — the row
   * exists iff the transition committed. Without it, behavior is the
   * original fire-and-forget write.
   */
  async log(
    entry: AuditEntry,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    try {
      await (tx ?? this.prisma).auditLog.create({
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
   * M23-W2 — STRICT, atomic audit write.
   *
   * `log()` above is deliberately fire-and-forget: it swallows write
   * failures so an audit problem can never fail a business operation.
   * That is the right trade-off for the paths it already serves, but it
   * is the wrong one for the S-2 configuration-mutation paths, where the
   * audit record is the whole point: a swallowed failure would let the
   * mutation commit unaudited and silently.
   *
   * `logAtomic` therefore REQUIRES a transaction client and lets the
   * error propagate, so the caller's transaction rolls back and neither
   * the mutation nor the audit row survives. The record exists if and
   * only if the mutation committed — exactly once, never orphaned.
   *
   * Existing `log()` behaviour and every existing caller are untouched.
   */
  async logAtomic(
    entry: AuditEntry,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        collegeId: entry.collegeId,
        actorId: entry.actorId ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        metadata: (entry.metadata ?? {}) as object,
      },
    });
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
