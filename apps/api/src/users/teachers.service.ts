import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateTeacherInput,
  PageMeta,
  PaginationQuery,
  TeacherDetail,
  TeacherItem,
  UpdateTeacherInput,
} from '@campusos/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../access/policy.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../access/authenticated-user';
import { pageArgs, pageMeta } from '../common/pagination/pagination';
import {
  CredentialTokensService,
  type IssuedCredentialLink,
} from '../auth/credential-tokens.service';

const teacherInclude = {
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
  _count: { select: { teachingAssignments: true } },
} satisfies Prisma.TeacherProfileInclude;

type TeacherRecord = Prisma.TeacherProfileGetPayload<{
  include: typeof teacherInclude;
}>;

function toItem(profile: TeacherRecord): TeacherItem {
  return {
    id: profile.id,
    userId: profile.user.id,
    firstName: profile.user.firstName,
    lastName: profile.user.lastName,
    email: profile.user.email,
    phone: profile.user.phone,
    userStatus: profile.user.status,
    employeeNo: profile.employeeNo,
    designation: profile.designation,
    qualification: profile.qualification,
    joinedOn: profile.joinedOn.toISOString().slice(0, 10),
    departmentId: profile.department.id,
    departmentName: profile.department.name,
    sectionCount: profile._count.teachingAssignments,
  };
}

@Injectable()
export class TeachersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly credentials: CredentialTokensService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: PaginationQuery & { departmentId?: string },
  ): Promise<{ data: TeacherItem[]; meta: PageMeta }> {
    // teachers.read is folded into users.read per the blueprint matrix;
    // STUDENT has OWN scope on users.read and owns no teacher profile.
    const scope = await this.policy.scopeFor(user, 'users.read');
    if (!scope) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      });
    }

    const where: Prisma.TeacherProfileWhereInput = {
      collegeId: user.collegeId,
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(scope === 'OWN' ? { userId: user.id } : {}),
      ...(query.q
        ? {
            OR: [
              { user: { firstName: { contains: query.q, mode: 'insensitive' } } },
              { user: { lastName: { contains: query.q, mode: 'insensitive' } } },
              { user: { email: { contains: query.q, mode: 'insensitive' } } },
              { employeeNo: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.teacherProfile.findMany({
        where,
        include: teacherInclude,
        orderBy: [{ employeeNo: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.teacherProfile.count({ where }),
    ]);
    return { data: rows.map(toItem), meta: pageMeta(query, total) };
  }

  async detail(user: AuthenticatedUser, id: string): Promise<TeacherDetail> {
    const profile = await this.prisma.teacherProfile.findFirst({
      where: { id, collegeId: user.collegeId },
      include: {
        ...teacherInclude,
        teachingAssignments: {
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
        message: 'Teacher not found',
      });
    }

    const scope = await this.policy.scopeFor(user, 'users.read');
    const allowed =
      scope === 'ALL' ||
      scope === 'ASSIGNED' || // teachers may view colleague profiles listed via sections
      (scope === 'OWN' &&
        (await this.policy.can(user, 'users.read', {
          ownerUserId: profile.userId,
        })));
    if (!allowed) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      });
    }

    return {
      ...toItem(profile),
      assignments: profile.teachingAssignments.map((assignment) => ({
        id: assignment.id,
        sectionId: assignment.sectionId,
        sectionName: assignment.section.name,
        courseCode: assignment.section.course.code,
        courseTitle: assignment.section.course.title,
        termLabel: assignment.section.term.label,
        isPrimary: assignment.isPrimary,
      })),
    };
  }

  async create(
    user: AuthenticatedUser,
    input: CreateTeacherInput,
  ): Promise<{ teacher: TeacherItem; invite: IssuedCredentialLink }> {
    const department = await this.prisma.department.findFirst({
      where: { id: input.departmentId, collegeId: user.collegeId },
      select: { id: true },
    });
    if (!department) {
      throw new BadRequestException({
        code: 'INVALID_DEPARTMENT',
        message: 'The selected department does not exist in this college',
      });
    }
    const emailTaken = await this.prisma.user.findFirst({
      where: { collegeId: user.collegeId, email: input.email },
      select: { id: true },
    });
    if (emailTaken) {
      throw new BadRequestException({
        code: 'DUPLICATE_EMAIL',
        message: `An account with email ${input.email} already exists`,
      });
    }
    const employeeTaken = await this.prisma.teacherProfile.findFirst({
      where: { collegeId: user.collegeId, employeeNo: input.employeeNo },
      select: { id: true },
    });
    if (employeeTaken) {
      throw new BadRequestException({
        code: 'DUPLICATE_EMPLOYEE_NO',
        message: `Employee number ${input.employeeNo} is already in use`,
      });
    }

    const passwordHash = await this.credentials.unusablePasswordHash();

    const created = await this.prisma.teacherProfile.create({
      data: {
        college: { connect: { id: user.collegeId } },
        department: { connect: { id: input.departmentId } },
        employeeNo: input.employeeNo,
        designation: input.designation,
        qualification: input.qualification,
        joinedOn: new Date(input.joinedOn),
        user: {
          create: {
            college: { connect: { id: user.collegeId } },
            email: input.email,
            passwordHash,
            role: 'TEACHER',
            firstName: input.firstName,
            lastName: input.lastName,
            phone: input.phone,
            mustChangePassword: true,
          },
        },
      },
      include: teacherInclude,
    });

    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'teachers.created',
      targetType: 'TeacherProfile',
      targetId: created.id,
    });
    const invite = await this.credentials.issue(created.user.id, 'INVITE', user);
    return { teacher: toItem(created), invite };
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateTeacherInput,
  ): Promise<TeacherItem> {
    const existing = await this.prisma.teacherProfile.findFirst({
      where: { id, collegeId: user.collegeId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Teacher not found',
      });
    }
    if (input.departmentId) {
      const department = await this.prisma.department.findFirst({
        where: { id: input.departmentId, collegeId: user.collegeId },
        select: { id: true },
      });
      if (!department) {
        throw new BadRequestException({
          code: 'INVALID_DEPARTMENT',
          message: 'The selected department does not exist in this college',
        });
      }
    }

    const updated = await this.prisma.teacherProfile.update({
      where: { id },
      data: {
        department: input.departmentId
          ? { connect: { id: input.departmentId } }
          : undefined,
        designation: input.designation,
        qualification: input.qualification,
        joinedOn: input.joinedOn ? new Date(input.joinedOn) : undefined,
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
      include: teacherInclude,
    });

    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'teachers.updated',
      targetType: 'TeacherProfile',
      targetId: id,
    });
    return toItem(updated);
  }

  /** Owning-module read used by academics (assignment validation). */
  async profileInCollege(
    collegeId: string,
    teacherProfileId: string,
  ): Promise<{ id: string; userId: string; name: string } | null> {
    const profile = await this.prisma.teacherProfile.findFirst({
      where: { id: teacherProfileId, collegeId },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!profile) return null;
    return {
      id: profile.id,
      userId: profile.user.id,
      name: `${profile.user.firstName} ${profile.user.lastName}`,
    };
  }
}
