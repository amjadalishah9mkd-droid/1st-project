import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  createAnnouncementSchema,
  paginationQuerySchema,
  PERMISSIONS,
  type AnnouncementItem,
  type CreateAnnouncementInput,
  type PageMeta,
  type PaginationQuery,
} from '@campusos/shared';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../access/policy.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.module';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';
import { pageArgs, pageMeta } from '../common/pagination/pagination';

const announcementInclude = {
  author: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.AnnouncementInclude;

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  private async audienceLabels(
    collegeId: string,
    scope: string,
    ids: string[],
  ): Promise<string[]> {
    if (scope === 'ALL') return ['Everyone'];
    if (scope === 'ROLE') return ids.map((role) => role);
    if (scope === 'DEPARTMENT') {
      const rows = await this.prisma.department.findMany({
        where: { id: { in: ids }, collegeId },
        select: { name: true },
      });
      return rows.map((row) => row.name);
    }
    const rows = await this.prisma.section.findMany({
      where: { id: { in: ids }, collegeId },
      include: { course: { select: { code: true } } },
    });
    return rows.map((row) => `${row.course.code} — Section ${row.name}`);
  }

  private async toItem(
    row: Prisma.AnnouncementGetPayload<{ include: typeof announcementInclude }>,
  ): Promise<AnnouncementItem> {
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      audienceScope: row.audienceScope,
      audienceLabels: await this.audienceLabels(
        row.collegeId,
        row.audienceScope,
        (row.audienceIds as string[]) ?? [],
      ),
      authorName: `${row.author.firstName} ${row.author.lastName}`,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Resolves the user ids the announcement should reach. */
  async resolveAudience(
    collegeId: string,
    scope: string,
    ids: string[],
  ): Promise<string[]> {
    if (scope === 'ALL') {
      const users = await this.prisma.user.findMany({
        where: { collegeId, status: 'ACTIVE' },
        select: { id: true },
      });
      return users.map((u) => u.id);
    }
    if (scope === 'ROLE') {
      const users = await this.prisma.user.findMany({
        where: { collegeId, status: 'ACTIVE', role: { in: ids as never[] } },
        select: { id: true },
      });
      return users.map((u) => u.id);
    }
    if (scope === 'DEPARTMENT') {
      const [teachers, students] = await Promise.all([
        this.prisma.teacherProfile.findMany({
          where: { collegeId, departmentId: { in: ids } },
          select: { userId: true },
        }),
        this.prisma.studentProfile.findMany({
          where: { collegeId, departmentId: { in: ids } },
          select: { userId: true },
        }),
      ]);
      return [...teachers, ...students].map((p) => p.userId);
    }
    // SECTION: enrolled students + assigned teachers.
    const [enrollments, assignments] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { sectionId: { in: ids }, status: 'ACTIVE' },
        select: { student: { select: { userId: true } } },
      }),
      this.prisma.teachingAssignment.findMany({
        where: { sectionId: { in: ids } },
        select: { teacher: { select: { userId: true } } },
      }),
    ]);
    return [
      ...new Set([
        ...enrollments.map((e) => e.student.userId),
        ...assignments.map((a) => a.teacher.userId),
      ]),
    ];
  }

  /**
   * Visibility: authors and ALL-scope announcements always; otherwise the
   * caller must be inside the audience. Admin sees everything.
   */
  async list(
    user: AuthenticatedUser,
    query: PaginationQuery,
  ): Promise<{ data: AnnouncementItem[]; meta: PageMeta }> {
    const scope = await this.policy.scopeFor(user, 'announcements.create');
    const rows = await this.prisma.announcement.findMany({
      where: { collegeId: user.collegeId, publishedAt: { not: null } },
      include: announcementInclude,
      orderBy: { publishedAt: 'desc' },
    });

    let visible = rows;
    if (scope !== 'ALL') {
      const filtered: typeof rows = [];
      for (const row of rows) {
        if (row.authorId === user.id || row.audienceScope === 'ALL') {
          filtered.push(row);
          continue;
        }
        const audience = await this.resolveAudience(
          user.collegeId,
          row.audienceScope,
          (row.audienceIds as string[]) ?? [],
        );
        if (audience.includes(user.id)) filtered.push(row);
      }
      visible = filtered;
    }

    const total = visible.length;
    const { skip, take } = pageArgs(query);
    const pageRows = visible.slice(skip, skip + take);
    const data: AnnouncementItem[] = [];
    for (const row of pageRows) data.push(await this.toItem(row));
    return { data, meta: pageMeta(query, total) };
  }

  async create(
    user: AuthenticatedUser,
    input: CreateAnnouncementInput,
  ): Promise<AnnouncementItem> {
    const scope = await this.policy.scopeFor(user, 'announcements.create');
    if (!scope) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      });
    }

    if (scope === 'ASSIGNED') {
      // Teachers may only announce to their own sections (Blueprint §5).
      if (input.audienceScope !== 'SECTION') {
        throw new ForbiddenException({
          code: 'SECTION_ONLY',
          message: 'You can only announce to your own sections',
        });
      }
      for (const sectionId of input.audienceIds) {
        const allowed = await this.policy.can(user, 'announcements.create', {
          sectionId,
        });
        if (!allowed) {
          throw new ForbiddenException({
            code: 'FORBIDDEN',
            message: 'You can only announce to sections you teach',
          });
        }
      }
    }

    // Validate audience ids belong to the college.
    if (input.audienceScope === 'DEPARTMENT') {
      const count = await this.prisma.department.count({
        where: { id: { in: input.audienceIds }, collegeId: user.collegeId },
      });
      if (count !== input.audienceIds.length) {
        throw new BadRequestException({
          code: 'INVALID_AUDIENCE',
          message: 'One or more departments do not exist in this college',
        });
      }
    }
    if (input.audienceScope === 'SECTION') {
      const count = await this.prisma.section.count({
        where: { id: { in: input.audienceIds }, collegeId: user.collegeId },
      });
      if (count !== input.audienceIds.length) {
        throw new BadRequestException({
          code: 'INVALID_AUDIENCE',
          message: 'One or more sections do not exist in this college',
        });
      }
    }
    if (
      input.audienceScope === 'ROLE' &&
      !input.audienceIds.every((role) =>
        ['ADMIN', 'TEACHER', 'STUDENT'].includes(role),
      )
    ) {
      throw new BadRequestException({
        code: 'INVALID_AUDIENCE',
        message: 'Unknown role in audience',
      });
    }

    const created = await this.prisma.announcement.create({
      data: {
        collegeId: user.collegeId,
        authorId: user.id,
        title: input.title,
        body: input.body,
        audienceScope: input.audienceScope,
        audienceIds: input.audienceIds,
        publishedAt: new Date(),
      },
      include: announcementInclude,
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'announcements.published',
      targetType: 'Announcement',
      targetId: created.id,
    });
    this.events.emit({
      type: 'announcement.published',
      announcementId: created.id,
      title: created.title,
      audienceScope: input.audienceScope,
      audienceIds: input.audienceIds,
    });
    return this.toItem(created);
  }
}

@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(paginationQuerySchema))
    query: z.infer<typeof paginationQuerySchema>,
  ) {
    return this.announcements.list(user, query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.ANNOUNCEMENTS_CREATE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createAnnouncementSchema))
    body: CreateAnnouncementInput,
  ) {
    return this.announcements.create(user, body);
  }
}
