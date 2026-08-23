import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateStudentInput,
  PaginationQuery,
  StudentDetail,
  StudentItem,
  UpdateStudentInput,
  PageMeta,
} from '@campusos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../access/policy.service';
import { AuditService } from '../audit/audit.service';
import {
  CredentialTokensService,
  type IssuedCredentialLink,
} from '../auth/credential-tokens.service';
import { MailService } from '../mail/mail.module';
import type { AuthenticatedUser } from '../access/authenticated-user';
import { pageArgs, pageMeta } from '../common/pagination/pagination';
import type { Prisma } from '@prisma/client';

const studentInclude = {
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      status: true,
    },
  },
  department: { select: { id: true, name: true } },
  _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
} satisfies Prisma.StudentProfileInclude;

type StudentRecord = Prisma.StudentProfileGetPayload<{
  include: typeof studentInclude;
}>;

function toItem(profile: StudentRecord): StudentItem {
  return {
    id: profile.id,
    userId: profile.user.id,
    firstName: profile.user.firstName,
    lastName: profile.user.lastName,
    email: profile.user.email,
    phone: profile.user.phone,
    status: profile.status,
    userStatus: profile.user.status,
    admissionNo: profile.admissionNo,
    rollNo: profile.rollNo,
    batch: profile.batch,
    departmentId: profile.department.id,
    departmentName: profile.department.name,
    enrollmentCount: profile._count.enrollments,
  };
}

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly credentials: CredentialTokensService,
    private readonly mail: MailService,
  ) {}

  /**
   * Scoped list per the users.read grant:
   * ALL → college-wide; ASSIGNED → students enrolled in the caller's
   * sections; OWN → the caller only.
   */
  async list(
    user: AuthenticatedUser,
    query: PaginationQuery & { departmentId?: string; sectionId?: string },
  ): Promise<{ data: StudentItem[]; meta: PageMeta }> {
    const scope = await this.policy.scopeFor(user, 'users.read');
    if (!scope) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      });
    }

    const where: Prisma.StudentProfileWhereInput = {
      collegeId: user.collegeId,
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.sectionId
        ? { enrollments: { some: { sectionId: query.sectionId, status: 'ACTIVE' } } }
        : {}),
      ...(query.q
        ? {
            OR: [
              { user: { firstName: { contains: query.q, mode: 'insensitive' } } },
              { user: { lastName: { contains: query.q, mode: 'insensitive' } } },
              { user: { email: { contains: query.q, mode: 'insensitive' } } },
              { admissionNo: { contains: query.q, mode: 'insensitive' } },
              { rollNo: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    if (scope === 'OWN') {
      where.userId = user.id;
    } else if (scope === 'ASSIGNED') {
      where.enrollments = {
        some: {
          status: 'ACTIVE',
          section: {
            teachingAssignments: { some: { teacher: { userId: user.id } } },
          },
          ...(query.sectionId ? { sectionId: query.sectionId } : {}),
        },
      };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.studentProfile.findMany({
        where,
        include: studentInclude,
        orderBy: [{ rollNo: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.studentProfile.count({ where }),
    ]);
    return { data: rows.map(toItem), meta: pageMeta(query, total) };
  }

  async detail(user: AuthenticatedUser, id: string): Promise<StudentDetail> {
    const profile = await this.prisma.studentProfile.findFirst({
      where: { id, collegeId: user.collegeId },
      include: {
        ...studentInclude,
        enrollments: {
          orderBy: { enrolledAt: 'desc' },
          include: {
            section: {
              include: {
                course: { select: { code: true, title: true } },
                term: { select: { label: true } },
              },
            },
          },
        },
      },
    });
    if (!profile) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Student not found',
      });
    }

    const scope = await this.policy.scopeFor(user, 'users.read');
    let allowed = false;
    if (scope === 'ALL') {
      allowed = true;
    } else if (scope === 'OWN') {
      allowed = await this.policy.can(user, 'users.read', {
        ownerUserId: profile.userId,
      });
    } else if (scope === 'ASSIGNED') {
      const shared = await this.prisma.enrollment.findFirst({
        where: {
          studentId: profile.id,
          status: 'ACTIVE',
          section: {
            teachingAssignments: { some: { teacher: { userId: user.id } } },
          },
        },
        select: { id: true },
      });
      allowed = shared !== null;
    }
    if (!allowed) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      });
    }

    return {
      ...toItem(profile),
      dateOfBirth: profile.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      guardianName: profile.guardianName,
      guardianPhone: profile.guardianPhone,
      guardianEmail: profile.guardianEmail,
      address: profile.address,
      enrollments: profile.enrollments.map((enrollment) => ({
        id: enrollment.id,
        sectionId: enrollment.sectionId,
        sectionName: enrollment.section.name,
        courseCode: enrollment.section.course.code,
        courseTitle: enrollment.section.course.title,
        termLabel: enrollment.section.term.label,
        status: enrollment.status,
        enrolledAt: enrollment.enrolledAt.toISOString(),
      })),
    };
  }

  async create(
    user: AuthenticatedUser,
    input: CreateStudentInput,
  ): Promise<{ student: StudentItem; invite: IssuedCredentialLink }> {
    await this.assertDepartmentInCollege(user.collegeId, input.departmentId);
    await this.assertEmailFree(user.collegeId, input.email);

    const duplicateAdmission = await this.prisma.studentProfile.findFirst({
      where: { collegeId: user.collegeId, admissionNo: input.admissionNo },
      select: { id: true },
    });
    if (duplicateAdmission) {
      throw new BadRequestException({
        code: 'DUPLICATE_ADMISSION_NO',
        message: `Admission number ${input.admissionNo} is already in use`,
      });
    }

    // M10-W2: the account starts with an unusable random password; access
    // is established through a one-time invitation link. No plaintext
    // password ever leaves the API.
    const passwordHash = await this.credentials.unusablePasswordHash();

    const created = await this.prisma.studentProfile.create({
      data: {
        college: { connect: { id: user.collegeId } },
        department: { connect: { id: input.departmentId } },
        admissionNo: input.admissionNo,
        rollNo: input.rollNo,
        batch: input.batch,
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : undefined,
        guardianName: input.guardianName,
        guardianPhone: input.guardianPhone,
        guardianEmail: input.guardianEmail,
        address: input.address,
        user: {
          create: {
            college: { connect: { id: user.collegeId } },
            email: input.email,
            passwordHash,
            role: 'STUDENT',
            firstName: input.firstName,
            lastName: input.lastName,
            phone: input.phone,
            mustChangePassword: true,
          },
        },
      },
      include: studentInclude,
    });

    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'students.created',
      targetType: 'StudentProfile',
      targetId: created.id,
    });
    const invite = await this.credentials.issue(created.user.id, 'INVITE', user);
    // M12-W1: deliver the same invite link by email (fire-and-forget; the
    // copy-URL dialog behavior is unchanged and never depends on mail).
    const college = await this.prisma.college.findUniqueOrThrow({
      where: { id: user.collegeId },
      select: { name: true },
    });
    await this.mail.send(
      { id: created.user.id, collegeId: user.collegeId, email: created.user.email },
      {
        kind: 'student_invite',
        firstName: created.user.firstName,
        collegeName: college.name,
        inviteUrl: this.mail.absoluteUrl(invite.url),
        expiresAt: invite.expiresAt,
      },
    );
    return { student: toItem(created), invite };
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateStudentInput,
  ): Promise<StudentItem> {
    const existing = await this.prisma.studentProfile.findFirst({
      where: { id, collegeId: user.collegeId },
      select: { id: true, userId: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Student not found',
      });
    }
    if (input.departmentId) {
      await this.assertDepartmentInCollege(user.collegeId, input.departmentId);
    }

    const updated = await this.prisma.studentProfile.update({
      where: { id },
      data: {
        department: input.departmentId
          ? { connect: { id: input.departmentId } }
          : undefined,
        rollNo: input.rollNo,
        batch: input.batch,
        status: input.status,
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : undefined,
        guardianName: input.guardianName,
        guardianPhone: input.guardianPhone,
        guardianEmail: input.guardianEmail,
        address: input.address,
        user:
          input.firstName || input.lastName || input.phone
            ? {
                update: {
                  firstName: input.firstName,
                  lastName: input.lastName,
                  phone: input.phone,
                },
              }
            : undefined,
      },
      include: studentInclude,
    });

    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'students.updated',
      targetType: 'StudentProfile',
      targetId: id,
    });
    return toItem(updated);
  }

  /** Owning-module read used by academics (enrollment validation). */
  async profileInCollege(
    collegeId: string,
    studentProfileId: string,
  ): Promise<{ id: string; userId: string; name: string } | null> {
    const profile = await this.prisma.studentProfile.findFirst({
      where: { id: studentProfileId, collegeId },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!profile) return null;
    return {
      id: profile.id,
      userId: profile.user.id,
      name: `${profile.user.firstName} ${profile.user.lastName}`,
    };
  }

  private async assertDepartmentInCollege(
    collegeId: string,
    departmentId: string,
  ): Promise<void> {
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, collegeId },
      select: { id: true },
    });
    if (!department) {
      throw new BadRequestException({
        code: 'INVALID_DEPARTMENT',
        message: 'The selected department does not exist in this college',
      });
    }
  }

  private async assertEmailFree(
    collegeId: string,
    email: string,
  ): Promise<void> {
    const existing = await this.prisma.user.findFirst({
      where: { collegeId, email },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException({
        code: 'DUPLICATE_EMAIL',
        message: `An account with email ${email} already exists`,
      });
    }
  }
}

