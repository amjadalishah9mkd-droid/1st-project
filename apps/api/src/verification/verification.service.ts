import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EVIDENCE_MAX_BYTES,
  EVIDENCE_MIME_TYPES,
  type ClaimAdminItem,
  type ClaimDecisionInput,
  type MyClaimItem,
  type PaginationQuery,
  type SubmitClaimInput,
} from '@campusos/shared';
import type { PageMeta } from '@campusos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.module';
import { LocalStorageAdapter } from '../files/storage.adapter';
import { pageArgs, pageMeta } from '../common/pagination/pagination';
import type { AuthenticatedUser } from '../access/authenticated-user';

const FILE_URL_PREFIX = '/api/v1/files/';

/** Magic-byte sniffing for the allowed evidence types (client MIME lies). */
function sniffMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'binary')))
    return 'image/png';
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-')
    return 'application/pdf';
  return null;
}

function evidenceName(key: string): string {
  return key.split('__').slice(1).join('__') || 'evidence';
}

/**
 * M11-W3 — student identity claims + evidence (Blueprint Rev. B §4, §6, §7).
 *
 * Duplicate prevention is delegated to the W1 partial unique indexes; this
 * service maps unique violations to enumeration-safe errors. Decisions are
 * atomic (guarded updateMany PENDING → decided) so retries fail cleanly and
 * notifications cannot duplicate. Authorization is PolicyService-driven via
 * @RequirePermission on the controller — no role checks here.
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly storage: LocalStorageAdapter,
  ) {}

  // ── Evidence upload (W3.10) ───────────────────────────────────────────────

  async uploadEvidence(
    user: AuthenticatedUser,
    file: Express.Multer.File | undefined,
  ): Promise<{ evidenceFileKey: string; name: string; size: number }> {
    if (!file || file.size === 0) {
      throw new BadRequestException({
        code: 'MISSING_FILE',
        message: 'Upload your student ID card in the "file" field',
      });
    }
    if (file.size > EVIDENCE_MAX_BYTES) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: 'ID evidence is limited to 5 MB',
      });
    }
    const sniffed = sniffMime(file.buffer);
    if (
      !sniffed ||
      !(EVIDENCE_MIME_TYPES as readonly string[]).includes(sniffed) ||
      !(EVIDENCE_MIME_TYPES as readonly string[]).includes(file.mimetype)
    ) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_FILE_TYPE',
        message: 'Upload a JPEG, PNG, WebP image or a PDF document',
      });
    }

    const stored = await this.storage.save(file.buffer, file.originalname);
    await this.prisma.evidenceFile.create({
      data: {
        key: stored.key,
        collegeId: user.collegeId,
        uploaderId: user.id,
        mimeType: sniffed,
        size: stored.size,
      },
    });
    // M19-W1: ownership record (EvidenceAuthzService stays the primary,
    // stricter gate for evidence keys; this adds the uniform tenant record).
    await this.prisma.storedFile.create({
      data: {
        key: stored.key,
        collegeId: user.collegeId,
        ownerUserId: user.id,
        createdById: user.id,
        purpose: 'EVIDENCE',
      },
    });
    return {
      evidenceFileKey: stored.key,
      name: evidenceName(stored.key),
      size: stored.size,
    };
  }

  // ── Claim submission (W3.1) ───────────────────────────────────────────────

  async submitClaim(
    user: AuthenticatedUser,
    input: SubmitClaimInput,
  ): Promise<MyClaimItem> {
    // Evidence must be an explicit verification upload owned by the
    // claimant — arbitrary/general files are never accepted (W3.1.4/5).
    const evidence = await this.prisma.evidenceFile.findFirst({
      where: {
        key: input.evidenceFileKey,
        uploaderId: user.id,
        collegeId: user.collegeId,
      },
    });
    if (!evidence) {
      throw new BadRequestException({
        code: 'INVALID_EVIDENCE',
        message: 'Upload your student ID card evidence first',
      });
    }

    // Fast, friendly path for a claimant who already has one in flight.
    const inFlight = await this.prisma.studentIdentityClaim.findFirst({
      where: { userId: user.id, status: 'PENDING' },
    });
    if (inFlight) {
      throw new ConflictException({
        code: 'CLAIM_PENDING',
        message: 'You already have a verification claim in progress',
      });
    }

    // Profile lookup is strictly college-scoped (W3.1.6/7). An admission
    // number from another college simply does not resolve.
    const profile = await this.prisma.studentProfile.findFirst({
      where: {
        collegeId: user.collegeId,
        admissionNo: input.claimedAdmissionNo,
      },
      select: { id: true },
    });

    try {
      const claim = await this.prisma.studentIdentityClaim.create({
        data: {
          collegeId: user.collegeId,
          userId: user.id,
          studentProfileId: profile?.id ?? null,
          claimedAdmissionNo: input.claimedAdmissionNo,
          evidenceFileKey: evidence.key,
        },
      });
      await this.prisma.user.update({
        where: { id: user.id },
        data: { verificationStatus: 'PENDING' },
      });
      await this.audit.log({
        collegeId: user.collegeId,
        actorId: user.id,
        action: 'verification.claim_submitted',
        targetType: 'StudentIdentityClaim',
        targetId: claim.id,
      });
      return this.toMyClaim(claim, evidence);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        // Live claim already holds this identity (race included). Generic:
        // reveals nothing about who holds it or whether it is verified.
        throw new ConflictException({
          code: 'CLAIM_UNAVAILABLE',
          message:
            'This identity cannot be claimed right now. Contact your college administration.',
        });
      }
      throw error;
    }
  }

  // ── Own claims (W3.2) ─────────────────────────────────────────────────────

  async myClaims(user: AuthenticatedUser): Promise<MyClaimItem[]> {
    const claims = await this.prisma.studentIdentityClaim.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    const evidences = await this.prisma.evidenceFile.findMany({
      where: {
        key: { in: claims.flatMap((c) => (c.evidenceFileKey ? [c.evidenceFileKey] : [])) },
      },
    });
    const byKey = new Map(evidences.map((e) => [e.key, e]));
    return claims.map((claim) =>
      this.toMyClaim(
        claim,
        claim.evidenceFileKey ? byKey.get(claim.evidenceFileKey) ?? null : null,
      ),
    );
  }

  private toMyClaim(
    claim: {
      id: string;
      claimedAdmissionNo: string;
      status: string;
      createdAt: Date;
      decidedAt: Date | null;
      rejectionReason: string | null;
    },
    evidence: { key: string; size: number } | null,
  ): MyClaimItem {
    return {
      id: claim.id,
      claimedAdmissionNo: claim.claimedAdmissionNo,
      status: claim.status as MyClaimItem['status'],
      createdAt: claim.createdAt.toISOString(),
      decidedAt: claim.decidedAt?.toISOString() ?? null,
      rejectionReason:
        claim.status === 'REJECTED' ? claim.rejectionReason : null,
      evidence: evidence
        ? { name: evidenceName(evidence.key), size: evidence.size }
        : null,
    };
  }

  // ── Admin queue + detail (W3.3/W3.4) ─────────────────────────────────────

  async listClaims(
    user: AuthenticatedUser,
    query: PaginationQuery & { status?: string },
  ): Promise<{ data: ClaimAdminItem[]; meta: PageMeta }> {
    const where = {
      collegeId: user.collegeId, // tenant scope, always
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.q
        ? {
            claimedAdmissionNo: {
              contains: query.q,
              mode: 'insensitive' as const,
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.studentIdentityClaim.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(query),
        include: this.adminInclude(),
      }),
      this.prisma.studentIdentityClaim.count({ where }),
    ]);
    const data = await Promise.all(rows.map((row) => this.toAdminItem(row)));
    return { data, meta: pageMeta(query, total) };
  }

  async claimDetail(
    user: AuthenticatedUser,
    claimId: string,
  ): Promise<ClaimAdminItem> {
    const claim = await this.prisma.studentIdentityClaim.findFirst({
      where: { id: claimId, collegeId: user.collegeId }, // cross-college → 404
      include: this.adminInclude(),
    });
    if (!claim) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Claim not found',
      });
    }
    return this.toAdminItem(claim);
  }

  private adminInclude() {
    return {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          verificationStatus: true,
        },
      },
      studentProfile: {
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          department: { select: { name: true } },
        },
      },
    } as const;
  }

  private async toAdminItem(claim: {
    id: string;
    status: string;
    claimedAdmissionNo: string;
    createdAt: Date;
    decidedAt: Date | null;
    rejectionReason: string | null;
    evidenceFileKey: string | null;
    userId: string;
    user: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      verificationStatus: string;
    };
    studentProfile: {
      id: string;
      admissionNo: string;
      rollNo: string;
      batch: string;
      user: { id: string; firstName: string; lastName: string };
      department: { name: string };
    } | null;
  }): Promise<ClaimAdminItem> {
    const evidence = claim.evidenceFileKey
      ? await this.prisma.evidenceFile.findUnique({
          where: { key: claim.evidenceFileKey },
        })
      : null;
    return {
      id: claim.id,
      status: claim.status as ClaimAdminItem['status'],
      claimedAdmissionNo: claim.claimedAdmissionNo,
      createdAt: claim.createdAt.toISOString(),
      decidedAt: claim.decidedAt?.toISOString() ?? null,
      rejectionReason: claim.rejectionReason,
      claimant: {
        id: claim.user.id,
        firstName: claim.user.firstName,
        lastName: claim.user.lastName,
        email: claim.user.email,
        verificationStatus: claim.user
          .verificationStatus as ClaimAdminItem['claimant']['verificationStatus'],
      },
      matchedProfile: claim.studentProfile
        ? {
            id: claim.studentProfile.id,
            admissionNo: claim.studentProfile.admissionNo,
            rollNo: claim.studentProfile.rollNo,
            batch: claim.studentProfile.batch,
            firstName: claim.studentProfile.user.firstName,
            lastName: claim.studentProfile.user.lastName,
            departmentName: claim.studentProfile.department.name,
            belongsToClaimant: claim.studentProfile.user.id === claim.userId,
          }
        : null,
      evidence: evidence
        ? {
            // Internal unsigned URL: unusable without POST /files/sign,
            // which enforces evidence authorization (W3.5).
            url: `${FILE_URL_PREFIX}${encodeURIComponent(evidence.key)}`,
            name: evidenceName(evidence.key),
            size: evidence.size,
            mimeType: evidence.mimeType,
          }
        : null,
    };
  }

  // ── Decision (W3.6) ──────────────────────────────────────────────────────

  async decide(
    admin: AuthenticatedUser,
    claimId: string,
    input: ClaimDecisionInput,
  ): Promise<ClaimAdminItem> {
    const claim = await this.prisma.studentIdentityClaim.findFirst({
      where: { id: claimId, collegeId: admin.collegeId }, // cross-college → 404
      include: { studentProfile: { select: { id: true, userId: true } } },
    });
    if (!claim) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Claim not found',
      });
    }
    if (claim.status !== 'PENDING') {
      throw new ConflictException({
        code: 'CLAIM_ALREADY_DECIDED',
        message: 'This claim has already been decided',
      });
    }

    if (input.decision === 'APPROVE') {
      if (!claim.studentProfile) {
        throw new BadRequestException({
          code: 'CLAIM_UNRESOLVED',
          message:
            'The claimed admission number does not match a student record. Reject the claim instead.',
        });
      }
      // D3 (locked): no account merging in v1. Approval requires the claimed
      // profile to belong to the claimant's own account; otherwise reject
      // with guidance and provision the student properly.
      if (claim.studentProfile.userId !== claim.userId) {
        throw new ConflictException({
          code: 'PROFILE_HAS_ACCOUNT',
          message:
            'This student record belongs to a different account. Reject the claim and invite the student through their existing account.',
        });
      }

      await this.prisma.$transaction(async (tx) => {
        // Atomic one-time transition — a concurrent/repeated decision loses.
        const updated = await tx.studentIdentityClaim.updateMany({
          where: { id: claim.id, status: 'PENDING' },
          data: {
            status: 'APPROVED',
            decidedById: admin.id,
            decidedAt: new Date(),
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException({
            code: 'CLAIM_ALREADY_DECIDED',
            message: 'This claim has already been decided',
          });
        }
        await tx.user.update({
          where: { id: claim.userId },
          data: { verificationStatus: 'VERIFIED' },
        });
      });
      await this.audit.log({
        collegeId: admin.collegeId,
        actorId: admin.id,
        action: 'verification.claim_approved',
        targetType: 'StudentIdentityClaim',
        targetId: claim.id,
        metadata: { claimantId: claim.userId },
      });
      this.events.emit({
        type: 'verification.approved',
        claimId: claim.id,
        userId: claim.userId,
      });
    } else {
      const updated = await this.prisma.studentIdentityClaim.updateMany({
        where: { id: claim.id, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          rejectionReason: input.rejectionReason ?? null,
          decidedById: admin.id,
          decidedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          code: 'CLAIM_ALREADY_DECIDED',
          message: 'This claim has already been decided',
        });
      }
      await this.prisma.user.update({
        where: { id: claim.userId },
        data: { verificationStatus: 'REJECTED' },
      });
      await this.audit.log({
        collegeId: admin.collegeId,
        actorId: admin.id,
        action: 'verification.claim_rejected',
        targetType: 'StudentIdentityClaim',
        targetId: claim.id,
        metadata: { claimantId: claim.userId },
      });
      this.events.emit({
        type: 'verification.rejected',
        claimId: claim.id,
        userId: claim.userId,
        rejectionReason: input.rejectionReason,
      });
    }

    return this.claimDetail(admin, claim.id);
  }
}
