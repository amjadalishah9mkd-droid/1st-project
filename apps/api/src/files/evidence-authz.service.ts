import { Injectable, NotFoundException } from '@nestjs/common';
import { PERMISSIONS } from '@campusos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../access/policy.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../access/authenticated-user';

/**
 * M11-W3 (W3.5) — evidence signing authorization.
 *
 * The M10-W1 signature proves a URL was issued by CampusOS; this service
 * additionally decides WHO may obtain that signature for verification
 * evidence:
 *   - the uploader (their own ID card), or
 *   - a holder of verification.manage for the evidence's college
 *     (PolicyService decides — no role checks).
 * Everyone else gets 404 — no existence leak, cross-college included.
 * Non-evidence keys are unaffected (M10-W1 behavior preserved).
 * Every successful evidence signing is audit-logged.
 */
@Injectable()
export class EvidenceAuthzService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  async assertCanSign(user: AuthenticatedUser, key: string): Promise<void> {
    const evidence = await this.prisma.evidenceFile.findUnique({
      where: { key },
      select: { id: true, uploaderId: true, collegeId: true },
    });
    if (!evidence) return; // ordinary file — existing rules apply

    const isUploader = evidence.uploaderId === user.id;
    const isReviewer =
      evidence.collegeId === user.collegeId &&
      (await this.policy.can(user, PERMISSIONS.VERIFICATION_MANAGE));

    if (!isUploader && !isReviewer) {
      // Indistinguishable from a nonexistent file.
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'File not found',
      });
    }

    await this.audit.log({
      collegeId: evidence.collegeId,
      actorId: user.id,
      action: 'verification.evidence_accessed',
      targetType: 'EvidenceFile',
      targetId: evidence.id,
      // Safe metadata only: never the key, signature or URL.
      metadata: { as: isUploader ? 'owner' : 'reviewer' },
    });
  }
}
