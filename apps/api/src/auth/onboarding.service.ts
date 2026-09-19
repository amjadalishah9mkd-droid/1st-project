import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.module';

export const SUPERSEDED_REASON =
  'Superseded by an administrator-issued invitation for this student record';

type Tx = Prisma.TransactionClient;

export interface OnboardingResult {
  verified: boolean;
  studentProfileId: string | null;
  superseded: Array<{ claimId: string; claimantId: string }>;
}

/**
 * M11-W4 — verified student onboarding.
 *
 * Invitation possession (M10-W2 token) or an authenticated session that
 * already owns the StudentProfile is admin-provisioned identity proof
 * (Blueprint Mode A). This service turns that proof into database facts,
 * inside the caller's transaction:
 *
 *  1. Any OTHER user's PENDING claim on the profile is superseded
 *     (REJECTED with an explicit reason; claimant → REJECTED).
 *  2. The user's own PENDING claim on the profile, if any, is APPROVED
 *     instead of duplicated.
 *  3. Otherwise a synthetic APPROVED StudentIdentityClaim is created so the
 *     W1 partial-unique index permanently holds the identity slot.
 *  4. The user becomes VERIFIED.
 *
 * PostgreSQL remains the final authority: a concurrent APPROVED claim makes
 * the synthetic insert fail with P2002 and the whole transaction (including
 * any invite-token consumption) rolls back.
 *
 * Audit/notifications are emitted by announce() AFTER the transaction
 * commits — decisions stay exactly-once because the state transitions here
 * are one-time.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  async applyVerification(
    tx: Tx,
    userId: string,
    decidedById: string | null,
  ): Promise<OnboardingResult> {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      include: { studentProfile: { select: { id: true, admissionNo: true } } },
    });
    // Data-driven: only accounts owning a StudentProfile participate.
    // Teachers/admins pass through untouched.
    if (!user.studentProfile) {
      return { verified: false, studentProfileId: null, superseded: [] };
    }
    if (user.verificationStatus === 'VERIFIED') {
      return {
        verified: false,
        studentProfileId: user.studentProfile.id,
        superseded: [],
      };
    }

    const profileId = user.studentProfile.id;
    const live = await tx.studentIdentityClaim.findMany({
      where: {
        studentProfileId: profileId,
        status: { in: ['PENDING', 'APPROVED'] },
      },
    });

    // D3 invariant: an APPROVED claim by someone else means the identity is
    // already bound elsewhere. Never merge — abort (rolls back the token).
    if (live.some((c) => c.status === 'APPROVED' && c.userId !== user.id)) {
      throw new ConflictException({
        code: 'IDENTITY_CONFLICT',
        message:
          'This student record is already verified for another account. Contact your college administration.',
      });
    }

    const now = new Date();
    const superseded: Array<{ claimId: string; claimantId: string }> = [];
    let holdsSlot = live.some(
      (c) => c.status === 'APPROVED' && c.userId === user.id,
    );

    for (const claim of live.filter((c) => c.status === 'PENDING')) {
      if (claim.userId === user.id) {
        // The invited student had their own claim in flight — approve it
        // rather than duplicating the slot.
        const updated = await tx.studentIdentityClaim.updateMany({
          where: { id: claim.id, status: 'PENDING' },
          data: { status: 'APPROVED', decidedById, decidedAt: now },
        });
        if (updated.count === 1) holdsSlot = true;
      } else {
        // Path E (approved decision): auto-supersession. An admin-issued
        // invitation outranks an unreviewed claim.
        const updated = await tx.studentIdentityClaim.updateMany({
          where: { id: claim.id, status: 'PENDING' },
          data: {
            status: 'REJECTED',
            rejectionReason: SUPERSEDED_REASON,
            decidedById,
            decidedAt: now,
          },
        });
        if (updated.count === 1) {
          await tx.user.update({
            where: { id: claim.userId },
            data: { verificationStatus: 'REJECTED' },
          });
          superseded.push({ claimId: claim.id, claimantId: claim.userId });
        }
      }
    }

    if (!holdsSlot) {
      // Synthetic APPROVED claim: the DB-level guarantee that this identity
      // can never be claimed again. P2002 here aborts the transaction.
      await tx.studentIdentityClaim.create({
        data: {
          collegeId: user.collegeId,
          userId: user.id,
          studentProfileId: profileId,
          claimedAdmissionNo: user.studentProfile.admissionNo,
          status: 'APPROVED',
          decidedById,
          decidedAt: now,
        },
      });
    }

    await tx.user.update({
      where: { id: user.id },
      data: { verificationStatus: 'VERIFIED' },
    });

    return { verified: true, studentProfileId: profileId, superseded };
  }

  /** Post-commit audit + notifications for an applyVerification result. */
  async announce(
    user: { id: string; collegeId: string },
    result: OnboardingResult,
    via: 'invitation' | 'link',
  ): Promise<void> {
    if (!result.verified) return;

    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'verification.auto_verified',
      targetType: 'User',
      targetId: user.id,
      metadata: { via },
    });
    this.events.emit({
      type: 'verification.approved',
      claimId: result.studentProfileId ?? '',
      userId: user.id,
    });

    for (const entry of result.superseded) {
      await this.audit.log({
        collegeId: user.collegeId,
        actorId: user.id,
        action: 'verification.claim_rejected',
        targetType: 'StudentIdentityClaim',
        targetId: entry.claimId,
        metadata: { claimantId: entry.claimantId, reason: 'superseded' },
      });
      this.events.emit({
        type: 'verification.rejected',
        claimId: entry.claimId,
        userId: entry.claimantId,
        rejectionReason: SUPERSEDED_REASON,
      });
    }
  }
}
