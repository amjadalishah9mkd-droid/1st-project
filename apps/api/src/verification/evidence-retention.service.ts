import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EVIDENCE_RETENTION_DAYS } from '@campusos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LocalStorageAdapter } from '../files/storage.adapter';

export const ORPHAN_RETENTION_DAYS = 7;

/**
 * M11-W7 — evidence retention (approved policy R3; do not change silently):
 *   - APPROVED claim evidence: purged 30 days after decidedAt
 *     (EVIDENCE_RETENTION_DAYS from shared — decision D5).
 *   - CANCELLED claim evidence: purged at the next sweep.
 *   - REJECTED claim evidence: retained (the student may resubmit; the
 *     admin decision references it).
 *   - Orphaned EvidenceFile rows (never attached to any claim): purged
 *     after 7 days.
 *
 * Purging removes the binary and the EvidenceFile metadata row ONLY. Claim
 * rows keep their evidenceFileKey string and all audit history remains —
 * historical accountability is never deleted. Every purge is audited as
 * verification.evidence_purged (system action, no actor).
 *
 * Ordering is storage-first: deleting the file is idempotent (ENOENT is a
 * no-op), so a crash between the two steps leaves a metadata row that the
 * next sweep converges on. No state can point at secretly-retained bytes.
 */
@Injectable()
export class EvidenceRetentionService {
  private readonly logger = new Logger(EvidenceRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: LocalStorageAdapter,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async nightly(): Promise<void> {
    try {
      const purged = await this.runSweep();
      if (purged > 0) {
        this.logger.log(`Evidence retention sweep purged ${purged} file(s)`);
      }
    } catch (error) {
      this.logger.error(
        'Evidence retention sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Runs one sweep; returns the number of purged evidence files. */
  async runSweep(now: Date = new Date()): Promise<number> {
    const approvedCutoff = new Date(
      now.getTime() - EVIDENCE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const orphanCutoff = new Date(
      now.getTime() - ORPHAN_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    const evidences = await this.prisma.evidenceFile.findMany();
    let purged = 0;

    for (const evidence of evidences) {
      const claims = await this.prisma.studentIdentityClaim.findMany({
        where: { evidenceFileKey: evidence.key },
        select: { status: true, decidedAt: true },
      });

      let reason: string | null = null;
      if (claims.length === 0) {
        if (evidence.createdAt < orphanCutoff) reason = 'orphan';
      } else if (
        // Purge only when EVERY referencing claim allows it: approved past
        // retention, or cancelled. Any PENDING/REJECTED reference retains.
        claims.every(
          (claim) =>
            claim.status === 'CANCELLED' ||
            (claim.status === 'APPROVED' &&
              claim.decidedAt !== null &&
              claim.decidedAt < approvedCutoff),
        )
      ) {
        reason = claims.some((c) => c.status === 'CANCELLED')
          ? 'cancelled'
          : 'approved_retention_elapsed';
      }

      if (!reason) continue;

      // Storage first (idempotent), then metadata — crash-safe convergence.
      await this.storage.delete(evidence.key);
      await this.prisma.evidenceFile.delete({ where: { id: evidence.id } });
      // M19-W1: remove the ownership record with the binary (idempotent).
      await this.prisma.storedFile.deleteMany({ where: { key: evidence.key } });
      await this.audit.log({
        collegeId: evidence.collegeId,
        actorId: null,
        action: 'verification.evidence_purged',
        targetType: 'EvidenceFile',
        targetId: evidence.id,
        metadata: { reason },
      });
      purged += 1;
    }

    // OAuth state hygiene (M11-W7): expired one-time consumption records.
    await this.prisma.oauthStateConsumption.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    return purged;
  }
}
