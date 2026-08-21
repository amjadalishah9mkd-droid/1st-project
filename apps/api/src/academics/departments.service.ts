import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateDepartmentInput,
  DepartmentItem,
  PageMeta,
  PaginationQuery,
  UpdateDepartmentInput,
} from '@campusos/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../access/authenticated-user';
import { pageArgs, pageMeta } from '../common/pagination/pagination';

const departmentInclude = {
  headTeacher: {
    include: { user: { select: { firstName: true, lastName: true } } },
  },
  _count: {
    select: { courses: true, teacherProfiles: true, studentProfiles: true },
  },
} satisfies Prisma.DepartmentInclude;

type DepartmentRecord = Prisma.DepartmentGetPayload<{
  include: typeof departmentInclude;
}>;

function toItem(row: DepartmentRecord): DepartmentItem {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    headTeacherId: row.headTeacherId,
    headTeacherName: row.headTeacher
      ? `${row.headTeacher.user.firstName} ${row.headTeacher.user.lastName}`
      : null,
    courseCount: row._count.courses,
    teacherCount: row._count.teacherProfiles,
    studentCount: row._count.studentProfiles,
  };
}

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: PaginationQuery,
  ): Promise<{ data: DepartmentItem[]; meta: PageMeta }> {
    const where: Prisma.DepartmentWhereInput = {
      collegeId: user.collegeId,
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { code: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.department.findMany({
        where,
        include: departmentInclude,
        orderBy: { code: 'asc' },
        ...pageArgs(query),
      }),
      this.prisma.department.count({ where }),
    ]);
    return { data: rows.map(toItem), meta: pageMeta(query, total) };
  }

  async detail(user: AuthenticatedUser, id: string): Promise<DepartmentItem> {
    const row = await this.prisma.department.findFirst({
      where: { id, collegeId: user.collegeId },
      include: departmentInclude,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Department not found',
      });
    }
    return toItem(row);
  }

  async create(
    user: AuthenticatedUser,
    input: CreateDepartmentInput,
  ): Promise<DepartmentItem> {
    const duplicate = await this.prisma.department.findFirst({
      where: { collegeId: user.collegeId, code: input.code },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException({
        code: 'DUPLICATE_DEPARTMENT_CODE',
        message: `Department code ${input.code} is already in use`,
      });
    }
    if (input.headTeacherId) {
      await this.assertHeadTeacher(user.collegeId, input.headTeacherId);
    }

    const created = await this.prisma.department.create({
      data: {
        collegeId: user.collegeId,
        name: input.name,
        code: input.code,
        headTeacherId: input.headTeacherId ?? null,
      },
      include: departmentInclude,
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'departments.created',
      targetType: 'Department',
      targetId: created.id,
    });
    return toItem(created);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateDepartmentInput,
  ): Promise<DepartmentItem> {
    const existing = await this.prisma.department.findFirst({
      where: { id, collegeId: user.collegeId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Department not found',
      });
    }
    if (input.headTeacherId) {
      await this.assertHeadTeacher(user.collegeId, input.headTeacherId);
    }

    const updated = await this.prisma.department.update({
      where: { id },
      data: {
        name: input.name,
        headTeacherId:
          input.headTeacherId === undefined ? undefined : input.headTeacherId,
      },
      include: departmentInclude,
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'departments.updated',
      targetType: 'Department',
      targetId: id,
    });
    return toItem(updated);
  }

  private async assertHeadTeacher(
    collegeId: string,
    teacherProfileId: string,
  ): Promise<void> {
    const teacher = await this.prisma.teacherProfile.findFirst({
      where: { id: teacherProfileId, collegeId },
      select: { id: true },
    });
    if (!teacher) {
      throw new BadRequestException({
        code: 'INVALID_HEAD_TEACHER',
        message: 'The selected head teacher does not exist in this college',
      });
    }
  }
}
