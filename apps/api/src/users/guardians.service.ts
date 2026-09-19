import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  GuardianChildItem,
  GuardianLinkItem,
  InviteGuardianInput,
} from '@campusos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.module';
import {
  CredentialTokensService,
  type IssuedCredentialLink,
} from '../auth/credential-tokens.service';
import type { AuthenticatedUser } from '../access/authenticated-user';

/**
 * M13-W2 — guardian onboarding & link lifecycle (decisions H1–H6).
 *
 * Creation invariant (closes the seam documented by W1's forged-link
 * test): the guardian account is created in — or looked up strictly
 * within — the admin's college; the student profile is resolved within
 * the same college; and the link is written with that collegeId inside
 * ONE transaction. A cross-college GuardianLink is unconstructible via
 * this API.
 *
 * Token/mail security is entirely inherited: INVITE CredentialTokens
 * (48h, hashed, one-time, reissue-revokes-prior) and the M12 MailService
 * (fire-and-forget; failures never roll back onboarding).
 */
@Injectable()
export class GuardiansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly credentials: CredentialTokensService,
  ) {}

  /** H3: children are referenced in mail as "FirstName L." only. */
  private childDisplayName(firstName: string, lastName: string): string {
    return `${firstName} ${lastName.charAt(0).toUpperCase()}.`;
  }

  private toLinkItem(link: {
    id: string;
    relationship: string;
    status: 'ACTIVE' | 'REVOKED';
    createdAt: Date;
    revokedAt: Date | null;
    guardian: { id: string; firstName: string; lastName: string; email: string };
    createdBy: { firstName: string; lastName: string } | null;
  }): GuardianLinkItem {
    return {
      id: link.id,
      relationship: link.relationship,
      status: link.status,
      createdAt: link.createdAt.toISOString(),
      revokedAt: link.revokedAt?.toISOString() ?? null,
      guardian: link.guardian,
      createdBy: link.createdBy,
    };
  }

  private readonly linkInclude = {
    guardian: {
      select: { id: true, firstName: true, lastName: true, email: true },
    },
    createdBy: { select: { firstName: true, lastName: true } },
  } as const;

  async invite(
    admin: AuthenticatedUser,
    studentProfileId: string,
    input: InviteGuardianInput,
  ): Promise<{ link: GuardianLinkItem; invite: IssuedCredentialLink | null }> {
    // Student strictly inside the admin's college (cross-college → 404).
    const profile = await this.prisma.studentProfile.findFirst({
      where: { id: studentProfileId, collegeId: admin.collegeId },
      include: {
        user: { select: { firstName: true, lastName: true } },
        college: { select: { name: true } },
      },
    });
    if (!profile) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Student not found' });
    }
    const studentName = this.childDisplayName(
      profile.user.firstName,
      profile.user.lastName,
    );

    // Existing account lookup is college-scoped: a same-email account in
    // another college is invisible and never linked.
    const existing = await this.prisma.user.findFirst({
      where: { email: input.email, collegeId: admin.collegeId },
      select: {
        id: true,
        role: true,
        status: true,
        firstName: true,
        email: true,
        passwordHash: true,
        mustChangePassword: true,
      },
    });

    if (existing && existing.role !== 'GUARDIAN') {
      // Never convert or link non-guardian accounts (decision C).
      throw new ConflictException({
        code: 'EMAIL_IN_USE',
        message: 'This email belongs to an existing non-guardian account',
      });
    }
    if (existing && existing.status !== 'ACTIVE') {
      throw new ConflictException({
        code: 'USER_INACTIVE',
        message: 'This guardian account is not active',
      });
    }

    if (existing) {
      return this.linkExistingGuardian(admin, profile.id, studentName, profile.college.name, existing, input);
    }
    return this.createNewGuardian(admin, profile.id, studentName, profile.college.name, input);
  }

  private async linkExistingGuardian(
    admin: AuthenticatedUser,
    studentProfileId: string,
    studentName: string,
    collegeName: string,
    guardian: {
      id: string;
      firstName: string;
      email: string;
      mustChangePassword: boolean;
    },
    input: InviteGuardianInput,
  ): Promise<{ link: GuardianLinkItem; invite: IssuedCredentialLink | null }> {
    const existingLink = await this.prisma.guardianLink.findUnique({
      where: {
        guardianUserId_studentProfileId: {
          guardianUserId: guardian.id,
          studentProfileId,
        },
      },
    });
    if (existingLink?.status === 'ACTIVE') {
      throw new ConflictException({
        code: 'LINK_EXISTS',
        message: 'This guardian is already linked to the student',
      });
    }

    let linkId: string;
    let reactivated = false;
    if (existingLink) {
      // H5: reactivate the SAME row (unique pair forbids a second one).
      await this.prisma.guardianLink.update({
        where: { id: existingLink.id },
        data: {
          status: 'ACTIVE',
          revokedAt: null,
          relationship: input.relationship,
          createdById: admin.id,
        },
      });
      linkId = existingLink.id;
      reactivated = true;
    } else {
      try {
        const link = await this.prisma.guardianLink.create({
          data: {
            collegeId: admin.collegeId,
            guardianUserId: guardian.id,
            studentProfileId,
            relationship: input.relationship,
            createdById: admin.id,
          },
        });
        linkId = link.id;
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
          throw new ConflictException({
            code: 'LINK_EXISTS',
            message: 'This guardian is already linked to the student',
          });
        }
        throw error;
      }
    }

    await this.audit.log({
      collegeId: admin.collegeId,
      actorId: admin.id,
      action: 'guardian.invited',
      targetType: 'GuardianLink',
      targetId: linkId,
      metadata: { studentProfileId, existing: true, reactivated },
    });
    await this.audit.log({
      collegeId: admin.collegeId,
      actorId: admin.id,
      action: 'guardian.link_created',
      targetType: 'GuardianLink',
      targetId: linkId,
      metadata: { studentProfileId, reactivated },
    });

    // Onboarded guardians (accepted their invite — mustChangePassword was
    // cleared) get the token-less notice (H4); a never-onboarded guardian
    // gets a fresh invite token (reissue revokes any prior one).
    let invite: IssuedCredentialLink | null = null;
    if (guardian.mustChangePassword) {
      invite = await this.credentials.issue(guardian.id, 'INVITE', admin);
      await this.mail.send(
        { id: guardian.id, collegeId: admin.collegeId, email: guardian.email },
        {
          kind: 'guardian_invite',
          firstName: guardian.firstName,
          collegeName,
          studentName,
          inviteUrl: this.mail.absoluteUrl(invite.url),
          expiresAt: invite.expiresAt,
        },
      );
    } else {
      await this.mail.send(
        { id: guardian.id, collegeId: admin.collegeId, email: guardian.email },
        {
          kind: 'guardian_link_added',
          firstName: guardian.firstName,
          collegeName,
          studentName,
          url: this.mail.absoluteUrl('/children'),
        },
      );
    }

    const link = await this.prisma.guardianLink.findUniqueOrThrow({
      where: { id: linkId },
      include: this.linkInclude,
    });
    return { link: this.toLinkItem(link), invite };
  }

  private async createNewGuardian(
    admin: AuthenticatedUser,
    studentProfileId: string,
    studentName: string,
    collegeName: string,
    input: InviteGuardianInput,
  ): Promise<{ link: GuardianLinkItem; invite: IssuedCredentialLink }> {
    const passwordHash = await this.credentials.unusablePasswordHash();

    // One transaction: user + link + invite token (creation invariant).
    const { userId, linkId, invite } = await this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: {
            college: { connect: { id: admin.collegeId } },
            email: input.email,
            passwordHash,
            role: 'GUARDIAN',
            firstName: 'Guardian',
            lastName: '',
            mustChangePassword: true,
          },
        });
        const link = await tx.guardianLink.create({
          data: {
            collegeId: admin.collegeId,
            guardianUserId: user.id,
            studentProfileId,
            relationship: input.relationship,
            createdById: admin.id,
          },
        });
        const issued = await this.credentials.issue(
          user.id,
          'INVITE',
          admin,
          tx,
        );
        return { userId: user.id, linkId: link.id, invite: issued };
      },
    );

    await this.audit.log({
      collegeId: admin.collegeId,
      actorId: admin.id,
      action: 'guardian.invited',
      targetType: 'GuardianLink',
      targetId: linkId,
      metadata: { studentProfileId, existing: false },
    });
    await this.audit.log({
      collegeId: admin.collegeId,
      actorId: admin.id,
      action: 'guardian.link_created',
      targetType: 'GuardianLink',
      targetId: linkId,
      metadata: { studentProfileId, reactivated: false },
    });
    await this.mail.send(
      { id: userId, collegeId: admin.collegeId, email: input.email },
      {
        kind: 'guardian_invite',
        firstName: 'Guardian',
        collegeName,
        studentName,
        inviteUrl: this.mail.absoluteUrl(invite.url),
        expiresAt: invite.expiresAt,
      },
    );

    const link = await this.prisma.guardianLink.findUniqueOrThrow({
      where: { id: linkId },
      include: this.linkInclude,
    });
    return { link: this.toLinkItem(link), invite };
  }

  async list(
    admin: AuthenticatedUser,
    studentProfileId: string,
  ): Promise<GuardianLinkItem[]> {
    const profile = await this.prisma.studentProfile.findFirst({
      where: { id: studentProfileId, collegeId: admin.collegeId },
      select: { id: true },
    });
    if (!profile) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Student not found' });
    }
    const links = await this.prisma.guardianLink.findMany({
      where: { studentProfileId, collegeId: admin.collegeId },
      orderBy: { createdAt: 'desc' },
      include: this.linkInclude,
    });
    return links.map((link) => this.toLinkItem(link));
  }

  async revoke(
    admin: AuthenticatedUser,
    studentProfileId: string,
    linkId: string,
  ): Promise<{ revoked: true }> {
    // Guarded transition: only ACTIVE rows in this college/student flip.
    const updated = await this.prisma.guardianLink.updateMany({
      where: {
        id: linkId,
        studentProfileId,
        collegeId: admin.collegeId,
        status: 'ACTIVE',
      },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    if (updated.count !== 1) {
      const exists = await this.prisma.guardianLink.findFirst({
        where: { id: linkId, studentProfileId, collegeId: admin.collegeId },
        select: { status: true },
      });
      if (exists?.status === 'REVOKED') {
        throw new ConflictException({
          code: 'ALREADY_REVOKED',
          message: 'This guardian link is already revoked',
        });
      }
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Link not found' });
    }
    await this.audit.log({
      collegeId: admin.collegeId,
      actorId: admin.id,
      action: 'guardian.link_revoked',
      targetType: 'GuardianLink',
      targetId: linkId,
      metadata: { studentProfileId },
    });
    return { revoked: true };
  }

  /** Guardian self-service: own ACTIVE links only — no client ids. */
  async children(user: AuthenticatedUser): Promise<GuardianChildItem[]> {
    const links = await this.prisma.guardianLink.findMany({
      where: {
        guardianUserId: user.id,
        collegeId: user.collegeId,
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'asc' },
      include: {
        studentProfile: {
          include: {
            user: { select: { firstName: true, lastName: true } },
            department: { select: { name: true } },
          },
        },
      },
    });
    return links.map((link) => ({
      studentProfileId: link.studentProfileId,
      firstName: link.studentProfile.user.firstName,
      lastName: link.studentProfile.user.lastName,
      admissionNo: link.studentProfile.admissionNo,
      rollNo: link.studentProfile.rollNo,
      batch: link.studentProfile.batch,
      departmentName: link.studentProfile.department.name,
      relationship: link.relationship,
      linkedAt: link.createdAt.toISOString(),
    }));
  }
}
