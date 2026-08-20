import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
}
