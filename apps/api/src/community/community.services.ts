import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateEventInput,
  CreateResourceInput,
  CreateSocietyInput,
  EventItem,
  PageMeta,
  PaginationQuery,
  ResourceItem,
  RsvpInput,
  SocietyDetail,
  SocietyItem,
  SocietyMemberInput,
  UpdateEventInput,
  UpdateSocietyInput,
} from '@campusos/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../access/policy.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.module';
import { CommunityAccessPolicy } from './community-access.policy';
import type { AuthenticatedUser } from '../access/authenticated-user';
import { pageArgs, pageMeta } from '../common/pagination/pagination';

function forbidden(): ForbiddenException {
  return new ForbiddenException({
    code: 'FORBIDDEN',
    message: 'You do not have permission to perform this action',
  });
}

// ── Societies ────────────────────────────────────────────────

const societyInclude = {
  facultyAdvisor: {
    include: { user: { select: { firstName: true, lastName: true } } },
  },
  _count: { select: { members: { where: { status: 'ACTIVE' } } } },
} satisfies Prisma.SocietyInclude;

@Injectable()
export class SocietiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly access: CommunityAccessPolicy,
  ) {}

  private async toItem(
    row: Prisma.SocietyGetPayload<{ include: typeof societyInclude }>,
    user: AuthenticatedUser,
  ): Promise<SocietyItem> {
    const membership = await this.prisma.societyMember.findFirst({
      where: { societyId: row.id, userId: user.id, status: 'ACTIVE' },
      select: { role: true },
    });
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      description: row.description,
      status: row.status,
      memberCount: row._count.members,
      facultyAdvisorName: row.facultyAdvisor
        ? `${row.facultyAdvisor.user.firstName} ${row.facultyAdvisor.user.lastName}`
        : null,
      myRole: membership?.role ?? null,
    };
  }

  async list(
    user: AuthenticatedUser,
    query: PaginationQuery,
  ): Promise<{ data: SocietyItem[]; meta: PageMeta }> {
    const where: Prisma.SocietyWhereInput = {
      collegeId: user.collegeId,
      status: 'ACTIVE',
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.society.findMany({
        where,
        include: societyInclude,
        orderBy: { name: 'asc' },
        ...pageArgs(query),
      }),
      this.prisma.society.count({ where }),
    ]);
    const data: SocietyItem[] = [];
    for (const row of rows) data.push(await this.toItem(row, user));
    return { data, meta: pageMeta(query, total) };
  }

  async detail(user: AuthenticatedUser, id: string): Promise<SocietyDetail> {
    const row = await this.prisma.society.findFirst({
      where: { id, collegeId: user.collegeId },
      include: {
        ...societyInclude,
        members: {
          where: { status: 'ACTIVE' },
          include: { user: { select: { firstName: true, lastName: true } } },
          orderBy: [{ role: 'desc' }, { joinedAt: 'asc' }],
        },
      },
    });
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Society not found' });
    }
    const item = await this.toItem(row, user);
    const isOfficer = item.myRole === 'OFFICER' || item.myRole === 'PRESIDENT';
    const isManager = await this.policy.can(user, 'community.societies.manage', {});
    return {
      ...item,
      members: row.members.map((member) => ({
        userId: member.userId,
        name: `${member.user.firstName} ${member.user.lastName}`,
        role: member.role,
      })),
      canManageMembers: isOfficer || isManager,
      canCreateEvents:
        isOfficer ||
        isManager ||
        (await this.policy.can(user, 'community.events.create', {})),
    };
  }

  async create(user: AuthenticatedUser, input: CreateSocietyInput): Promise<SocietyItem> {
    if (!(await this.policy.can(user, 'community.societies.manage', {}))) {
      throw forbidden();
    }
    const duplicate = await this.prisma.society.findFirst({
      where: { collegeId: user.collegeId, name: input.name },
    });
    if (duplicate) {
      throw new BadRequestException({
        code: 'DUPLICATE_SOCIETY_NAME',
        message: `A society named "${input.name}" already exists`,
      });
    }
    if (input.facultyAdvisorId) {
      const advisor = await this.prisma.teacherProfile.findFirst({
        where: { id: input.facultyAdvisorId, collegeId: user.collegeId },
      });
      if (!advisor) {
        throw new BadRequestException({
          code: 'INVALID_ADVISOR',
          message: 'The selected faculty advisor does not exist in this college',
        });
      }
    }
    const created = await this.prisma.society.create({
      data: {
        collegeId: user.collegeId,
        name: input.name,
        category: input.category,
        description: input.description,
        facultyAdvisorId: input.facultyAdvisorId ?? null,
      },
      include: societyInclude,
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'community.society_created',
      targetType: 'Society',
      targetId: created.id,
    });
    return this.toItem(created, user);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateSocietyInput,
  ): Promise<SocietyItem> {
    if (!(await this.policy.can(user, 'community.societies.manage', {}))) {
      throw forbidden();
    }
    const existing = await this.prisma.society.findFirst({
      where: { id, collegeId: user.collegeId },
    });
    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Society not found' });
    }
    const updated = await this.prisma.society.update({
      where: { id },
      data: {
        name: input.name,
        category: input.category,
        description: input.description,
        facultyAdvisorId: input.facultyAdvisorId,
        status: input.status,
      },
      include: societyInclude,
    });
    return this.toItem(updated, user);
  }

  /** Officers/president (or admin) manage members. */
  async upsertMember(
    user: AuthenticatedUser,
    societyId: string,
    input: SocietyMemberInput,
  ): Promise<SocietyDetail> {
    const detail = await this.detail(user, societyId);
    if (!detail.canManageMembers) throw forbidden();
    const target = await this.prisma.user.findFirst({
      where: { id: input.userId, collegeId: user.collegeId, status: 'ACTIVE' },
    });
    if (!target) {
      throw new BadRequestException({
        code: 'INVALID_USER',
        message: 'The selected user does not exist in this college',
      });
    }
    const existing = await this.prisma.societyMember.findUnique({
      where: { societyId_userId: { societyId, userId: input.userId } },
    });
    if (existing) {
      await this.prisma.societyMember.update({
        where: { id: existing.id },
        data: { role: input.role, status: 'ACTIVE' },
      });
    } else {
      await this.prisma.societyMember.create({
        data: { societyId, userId: input.userId, role: input.role },
      });
      this.events.emit({
        type: 'community.membership_decided',
        scope: 'SOCIETY',
        targetId: societyId,
        targetName: detail.name,
        memberUserId: input.userId,
        approved: true,
      });
    }
    return this.detail(user, societyId);
  }

  async removeMember(
    user: AuthenticatedUser,
    societyId: string,
    targetUserId: string,
  ): Promise<SocietyDetail> {
    const detail = await this.detail(user, societyId);
    const removingSelf = targetUserId === user.id;
    if (!removingSelf && !detail.canManageMembers) throw forbidden();
    const membership = await this.prisma.societyMember.findUnique({
      where: { societyId_userId: { societyId, userId: targetUserId } },
    });
    if (!membership) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Membership not found' });
    }
    await this.prisma.societyMember.delete({ where: { id: membership.id } });
    return this.detail(user, societyId);
  }
}

// ── Events ───────────────────────────────────────────────────

const eventInclude = {
  society: { select: { id: true, name: true } },
  createdBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.EventInclude;

@Injectable()
export class CommunityEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly access: CommunityAccessPolicy,
  ) {}

  private async canManageEvent(
    user: AuthenticatedUser,
    societyId: string | null,
    createdById?: string,
  ): Promise<boolean> {
    if (createdById === user.id) return true;
    if (await this.policy.can(user, 'community.societies.manage', {})) return true;
    if (societyId) {
      const officer = await this.prisma.societyMember.findFirst({
        where: {
          societyId,
          userId: user.id,
          role: { in: ['OFFICER', 'PRESIDENT'] },
          status: 'ACTIVE',
        },
      });
      if (officer) return true;
    }
    return false;
  }

  private async toItem(
    row: Prisma.EventGetPayload<{ include: typeof eventInclude }>,
    user: AuthenticatedUser,
  ): Promise<EventItem> {
    const [going, interested, mine] = await Promise.all([
      this.prisma.eventRsvp.count({ where: { eventId: row.id, status: 'GOING' } }),
      this.prisma.eventRsvp.count({
        where: { eventId: row.id, status: 'INTERESTED' },
      }),
      this.prisma.eventRsvp.findUnique({
        where: { eventId_userId: { eventId: row.id, userId: user.id } },
      }),
    ]);
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      venue: row.venue,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      capacity: row.capacity,
      status: row.status,
      societyId: row.society?.id ?? null,
      societyName: row.society?.name ?? null,
      createdByName: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
      goingCount: going,
      interestedCount: interested,
      myRsvp: mine?.status ?? null,
      canManage: await this.canManageEvent(user, row.societyId, row.createdById),
    };
  }

  async list(
    user: AuthenticatedUser,
    query: PaginationQuery & { societyId?: string },
  ): Promise<{ data: EventItem[]; meta: PageMeta }> {
    const where: Prisma.EventWhereInput = {
      collegeId: user.collegeId,
      status: { not: 'REMOVED' },
      ...(query.societyId ? { societyId: query.societyId } : {}),
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        include: eventInclude,
        orderBy: { startsAt: 'asc' },
        ...pageArgs(query),
      }),
      this.prisma.event.count({ where }),
    ]);
    const data: EventItem[] = [];
    for (const row of rows) data.push(await this.toItem(row, user));
    return { data, meta: pageMeta(query, total) };
  }

  async create(user: AuthenticatedUser, input: CreateEventInput): Promise<EventItem> {
    await this.access.assertParticipant(user);

    if (input.societyId) {
      const society = await this.prisma.society.findFirst({
        where: { id: input.societyId, collegeId: user.collegeId, status: 'ACTIVE' },
      });
      if (!society) {
        throw new BadRequestException({
          code: 'INVALID_SOCIETY',
          message: 'The selected society does not exist in this college',
        });
      }
      if (!(await this.canManageEvent(user, input.societyId))) {
        throw forbidden();
      }
    } else if (!(await this.policy.can(user, 'community.events.create', {}))) {
      // Campus-wide events need the permission (admins/teachers per matrix).
      throw forbidden();
    }

    const created = await this.prisma.event.create({
      data: {
        collegeId: user.collegeId,
        societyId: input.societyId ?? null,
        title: input.title,
        description: input.description,
        venue: input.venue,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        capacity: input.capacity,
        createdById: user.id,
      },
      include: eventInclude,
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'community.event_created',
      targetType: 'Event',
      targetId: created.id,
    });
    this.events.emit({
      type: 'event.created',
      eventId: created.id,
      title: created.title,
      startsAt: created.startsAt.toISOString(),
      societyId: created.societyId,
    });
    return this.toItem(created, user);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateEventInput,
  ): Promise<EventItem> {
    const row = await this.prisma.event.findFirst({
      where: { id, collegeId: user.collegeId },
      include: eventInclude,
    });
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Event not found' });
    }
    if (!(await this.canManageEvent(user, row.societyId, row.createdById))) {
      throw forbidden();
    }
    const updated = await this.prisma.event.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        venue: input.venue,
        startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
        endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
        capacity: input.capacity,
        status: input.status,
      },
      include: eventInclude,
    });
    return this.toItem(updated, user);
  }

  async rsvp(
    user: AuthenticatedUser,
    eventId: string,
    input: RsvpInput,
  ): Promise<EventItem> {
    await this.access.assertParticipant(user);
    const row = await this.prisma.event.findFirst({
      where: { id: eventId, collegeId: user.collegeId, status: 'ACTIVE' },
      include: eventInclude,
    });
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Event not found' });
    }
    if (input.status === 'GOING' && row.capacity !== null) {
      const going = await this.prisma.eventRsvp.count({
        where: { eventId, status: 'GOING', userId: { not: user.id } },
      });
      if (going >= row.capacity) {
        throw new ConflictException({
          code: 'EVENT_FULL',
          message: 'This event is at capacity',
        });
      }
    }
    await this.prisma.eventRsvp.upsert({
      where: { eventId_userId: { eventId, userId: user.id } },
      update: { status: input.status },
      create: { eventId, userId: user.id, status: input.status },
    });
    return this.toItem(row, user);
  }
}

// ── Resources ────────────────────────────────────────────────

const resourceInclude = {
  uploader: { select: { firstName: true, lastName: true } },
  course: { select: { code: true } },
} satisfies Prisma.ResourceInclude;

@Injectable()
export class ResourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CommunityAccessPolicy,
  ) {}

  private toItem(
    row: Prisma.ResourceGetPayload<{ include: typeof resourceInclude }>,
  ): ResourceItem {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      courseCode: row.course?.code ?? null,
      fileName: row.fileName,
      fileType: row.fileType,
      fileSize: row.fileSize,
      downloadCount: row.downloadCount,
      uploaderName: `${row.uploader.firstName} ${row.uploader.lastName}`,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(
    user: AuthenticatedUser,
    query: PaginationQuery & { courseId?: string },
  ): Promise<{ data: ResourceItem[]; meta: PageMeta }> {
    const where: Prisma.ResourceWhereInput = {
      collegeId: user.collegeId,
      status: 'ACTIVE',
      ...(query.courseId ? { courseId: query.courseId } : {}),
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.resource.findMany({
        where,
        include: resourceInclude,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(query),
      }),
      this.prisma.resource.count({ where }),
    ]);
    return { data: rows.map((r) => this.toItem(r)), meta: pageMeta(query, total) };
  }

  async create(
    user: AuthenticatedUser,
    input: CreateResourceInput,
  ): Promise<ResourceItem> {
    await this.access.assertParticipant(user);
    if (input.courseId) {
      const course = await this.prisma.course.findFirst({
        where: { id: input.courseId, collegeId: user.collegeId },
      });
      if (!course) {
        throw new BadRequestException({
          code: 'INVALID_COURSE',
          message: 'The selected course does not exist in this college',
        });
      }
    }
    const created = await this.prisma.resource.create({
      data: {
        collegeId: user.collegeId,
        uploaderId: user.id,
        courseId: input.courseId,
        title: input.title,
        description: input.description,
        fileUrl: input.fileUrl,
        fileName: input.fileName,
        fileType: input.fileType,
        fileSize: input.fileSize,
      },
      include: resourceInclude,
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'community.resource_created',
      targetType: 'Resource',
      targetId: created.id,
    });
    return this.toItem(created);
  }

  /** Returns the file URL and increments the real download counter. */
  async download(user: AuthenticatedUser, id: string): Promise<{ url: string }> {
    const resource = await this.prisma.resource.findFirst({
      where: { id, collegeId: user.collegeId, status: 'ACTIVE' },
    });
    if (!resource) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Resource not found' });
    }
    await this.prisma.resource.update({
      where: { id },
      data: { downloadCount: { increment: 1 } },
    });
    return { url: resource.fileUrl };
  }
}
