import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../access/authenticated-user';

/**
 * M19-W1 (P2-IDOR-1) — stored-file ownership authorization.
 *
 * Complements the M10-W1 HMAC signature (proves the URL was issued by
 * CampusOS) and the M11-W3 evidence rules (per-user, strictest class) with a
 * tenant/ownership gate for EVERY key that has a StoredFile record:
 *
 *   - owner may always sign their own file;
 *   - other members of the SAME college may sign it (attachments on
 *     assignments/posts are shared in-college content by design);
 *   - anyone else — cross-college included — gets 404, indistinguishable
 *     from a nonexistent file (no existence leak).
 *
 * Keys WITHOUT a record are pre-M19 uploads that could not be safely
 * derived during the migration-#13 backfill. They are grandfathered:
 * the original capability-URL behavior applies unchanged, so every
 * existing stored URL keeps working. All new uploads are recorded, so the
 * grandfathered class only ever shrinks.
 *
 * Evidence keys are checked by EvidenceAuthzService FIRST (stricter:
 * uploader or verification.manage holder only); this service then merely
 * re-affirms tenancy for them.
 */
@Injectable()
export class StoredFileAuthzService {
  constructor(private readonly prisma: PrismaService) {}

  /** Record ownership for a freshly stored key (insert-first; key unique). */
  async record(input: {
    key: string;
    collegeId: string;
    ownerUserId: string;
    purpose?: 'COMMUNITY_ATTACHMENT' | 'SUBMISSION' | 'EVIDENCE' | 'OTHER';
  }): Promise<void> {
    await this.prisma.storedFile.create({
      data: {
        key: input.key,
        collegeId: input.collegeId,
        ownerUserId: input.ownerUserId,
        createdById: input.ownerUserId,
        purpose: input.purpose ?? 'OTHER',
      },
    });
  }

  async assertCanSign(user: AuthenticatedUser, key: string): Promise<void> {
    const record = await this.prisma.storedFile.findUnique({
      where: { key },
      select: { collegeId: true, ownerUserId: true },
    });
    if (!record) return; // grandfathered legacy key — M10-W1 rules apply
    if (record.ownerUserId === user.id) return;
    if (record.collegeId === user.collegeId) return;
    // Foreign tenant: indistinguishable from a nonexistent file.
    throw new NotFoundException({
      code: 'NOT_FOUND',
      message: 'File not found',
    });
  }
}
