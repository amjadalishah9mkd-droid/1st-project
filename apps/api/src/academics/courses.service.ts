import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CourseItem,
  CreateCourseInput,
  PageMeta,
  PaginationQuery,
  UpdateCourseInput,
} from '@campusos/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../access/policy.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../access/authenticated-user';
import { pageArgs, pageMeta } from '../common/pagination/pagination';

const courseInclude = {
  department: { select: { id: true, name: true, code: true } },
  _count: { select: { sections: true } },
} satisfies Prisma.CourseInclude;

type CourseRecord = Prisma.CourseGetPayload<{ include: typeof courseInclude }>;

function toItem(row: CourseRecord): CourseItem {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    credits: row.credits,
    description: row.description,
    status: row.status,
    departmentId: row.department.id,
    departmentName: row.department.name,
    departmentCode: row.department.code,
    sectionCount: row._count.sections,
  };
}

@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  /** OWN scope (students) sees only courses of sections they're enrolled in. */
  async list(
    user: AuthenticatedUser,
    query: PaginationQuery & { departmentId?: string; status?: string },
  ): Promise<{ data: CourseItem[]; meta: PageMeta }> {
    const scope = await this.policy.scopeFor(user, 'academics.read');
    const where: Prisma.CourseWhereInput = {
      collegeId: user.collegeId,
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(scope === 'OWN'
        ? {
            sections: {
              some: {
                enrollments: {
                  some: { student: { userId: user.id }, status: 'ACTIVE' },
                },
              },
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { code: { contains: query.q, mode: 'insensitive' } },
              { title: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.course.findMany({
        where,
        include: courseInclude,
        orderBy: { code: 'asc' },
        ...pageArgs(query),
      }),
      this.prisma.course.count({ where }),
    ]);
    return { data: rows.map(toItem), meta: pageMeta(query, total) };
  }

  async detail(user: AuthenticatedUser, id: string): Promise<CourseItem> {
    const row = await this.prisma.course.findFirst({
      where: { id, collegeId: user.collegeId },
      include: courseInclude,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Course not found',
      });
    }
    return toItem(row);
  }

  async create(
    user: AuthenticatedUser,
    input: CreateCourseInput,
  ): Promise<CourseItem> {
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
    const duplicate = await this.prisma.course.findFirst({
      where: { collegeId: user.collegeId, code: input.code },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException({
        code: 'DUPLICATE_COURSE_CODE',
        message: `Course code ${input.code} is already in use`,
      });
    }

    const created = await this.prisma.course.create({
      data: {
        collegeId: user.collegeId,
        departmentId: input.departmentId,
        code: input.code,
        title: input.title,
        credits: input.credits,
        description: input.description,
      },
      include: courseInclude,
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'courses.created',
      targetType: 'Course',
      targetId: created.id,
    });
    return toItem(created);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateCourseInput,
  ): Promise<CourseItem> {
    const existing = await this.prisma.course.findFirst({
      where: { id, collegeId: user.collegeId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Course not found',
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

    const updated = await this.prisma.course.update({
      where: { id },
      data: {
        departmentId: input.departmentId,
        title: input.title,
        credits: input.credits,
        description: input.description,
        status: input.status,
      },
      include: courseInclude,
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'courses.updated',
      targetType: 'Course',
      targetId: id,
      metadata: input.status ? { status: input.status } : undefined,
    });
    return toItem(updated);
  }
}
