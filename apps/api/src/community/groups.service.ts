import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateGroupInput,
  GroupDetail,
  GroupItem,
  PageMeta,
  PaginationQuery,
  UpdateGroupInput,
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

const groupInclude = {
  createdBy: { select: { firstName: true, lastName: true } },
  _count: { select: { members: { where: { status: 'ACTIVE' } } } },
} satisfies Prisma.GroupInclude;

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly access: CommunityAccessPolicy,
  ) {}

  private async toItem(
    row: Prisma.GroupGetPayload<{ include: typeof groupInclude }>,
    user: AuthenticatedUser,
  ): Promise<GroupItem> {
    const membership = await this.prisma.groupMember.findFirst({
      where: { groupId: row.id, userId: user.id },
      select: { role: true, status: true },
    });
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      privacy: row.privacy,
      memberCount: row._count.members,
      myMembership: membership,
      createdByName: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
    };
  }

  async list(
    user: AuthenticatedUser,
    query: PaginationQuery,
  ): Promise<{ data: GroupItem[]; meta: PageMeta }> {
    const where: Prisma.GroupWhereInput = {
      collegeId: user.collegeId,
      status: 'ACTIVE',
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.group.findMany({
        where,
        include: groupInclude,
        orderBy: { name: 'asc' },
        ...pageArgs(query),
      }),
      this.prisma.group.count({ where }),
    ]);
    const data: GroupItem[] = [];
    for (const row of rows) data.push(await this.toItem(row, user));
    return { data, meta: pageMeta(query, total) };
  }

  async detail(user: AuthenticatedUser, id: string): Promise<GroupDetail> {
    const row = await this.prisma.group.findFirst({
      where: { id, collegeId: user.collegeId, status: 'ACTIVE' },
      include: {
        ...groupInclude,
        members: {
          include: { user: { select: { firstName: true, lastName: true } } },
          orderBy: [{ role: 'desc' }, { joinedAt: 'asc' }],
        },
      },
    });
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Group not found' });
    }
    const item = await this.toItem(row, user);
    const canModerate =
      item.myMembership?.role === 'MODERATOR' &&
      item.myMembership.status === 'ACTIVE';
    return {
      ...item,
      members: row.members.map((member) => ({
        userId: member.userId,
        name: `${member.user.firstName} ${member.user.lastName}`,
        role: member.role,
        status: member.status,
      })),
      canModerate,
    };
  }

  async create(user: AuthenticatedUser, input: CreateGroupInput): Promise<GroupItem> {
    await this.access.assertParticipant(user);
    if (!(await this.policy.can(user, 'community.groups.create', {}))) {
      throw forbidden();
    }
    const duplicate = await this.prisma.group.findFirst({
      where: { collegeId: user.collegeId, name: input.name },
    });
    if (duplicate) {
      throw new BadRequestException({
        code: 'DUPLICATE_GROUP_NAME',
        message: `A group named "${input.name}" already exists`,
      });
    }
    // Creator becomes the group's moderator.
    const created = await this.prisma.group.create({
      data: {
        collegeId: user.collegeId,
        name: input.name,
        description: input.description,
        privacy: input.privacy,
        createdById: user.id,
        members: {
          create: { userId: user.id, role: 'MODERATOR', status: 'ACTIVE' },
        },
      },
      include: groupInclude,
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'community.group_created',
      targetType: 'Group',
      targetId: created.id,
    });
    return this.toItem(created, user);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateGroupInput,
  ): Promise<GroupItem> {
    const detail = await this.detail(user, id);
    if (!detail.canModerate) throw forbidden();
    const updated = await this.prisma.group.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        privacy: input.privacy,
      },
      include: groupInclude,
    });
    return this.toItem(updated, user);
  }

  /** Join: OPEN → ACTIVE immediately; REQUEST → PENDING + moderators notified. */
  async join(user: AuthenticatedUser, groupId: string): Promise<GroupDetail> {
    await this.access.assertParticipant(user);
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, collegeId: user.collegeId, status: 'ACTIVE' },
    });
    if (!group) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Group not found' });
    }
    const existing = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: user.id } },
    });
    if (existing) {
      throw new ConflictException({
        code: 'ALREADY_MEMBER',
        message:
          existing.status === 'PENDING'
            ? 'Your join request is pending approval'
            : 'You are already a member of this group',
      });
    }
    const status = group.privacy === 'OPEN' ? 'ACTIVE' : 'PENDING';
    await this.prisma.groupMember.create({
      data: { groupId, userId: user.id, status },
    });
    if (status === 'PENDING') {
      const moderators = await this.prisma.groupMember.findMany({
        where: { groupId, role: 'MODERATOR', status: 'ACTIVE' },
        select: { userId: true },
      });
      this.events.emit({
        type: 'community.group_request',
        groupId,
        groupName: group.name,
        requesterUserId: user.id,
        moderatorUserIds: moderators.map((m) => m.userId),
      });
    }
    return this.detail(user, groupId);
  }

  /** Leave (self) or remove a member (moderator, via userId). */
  async leave(
    user: AuthenticatedUser,
    groupId: string,
    targetUserId?: string,
  ): Promise<GroupDetail> {
    const detail = await this.detail(user, groupId);
    const removingOther = targetUserId !== undefined && targetUserId !== user.id;
    if (removingOther && !detail.canModerate) throw forbidden();
    const memberUserId = removingOther ? targetUserId! : user.id;

    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: memberUserId } },
    });
    if (!membership) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Membership not found' });
    }
    // The last moderator cannot leave — a group must stay governable.
    if (membership.role === 'MODERATOR') {
      const otherModerators = await this.prisma.groupMember.count({
        where: {
          groupId,
          role: 'MODERATOR',
          status: 'ACTIVE',
          userId: { not: memberUserId },
        },
      });
      if (otherModerators === 0) {
        throw new BadRequestException({
          code: 'LAST_MODERATOR',
          message: 'The last moderator cannot leave the group',
        });
      }
    }
    await this.prisma.groupMember.delete({ where: { id: membership.id } });
    return this.detail(user, groupId);
  }

  /** Approve a PENDING request (moderators only). */
  async approve(
    user: AuthenticatedUser,
    groupId: string,
    targetUserId: string,
  ): Promise<GroupDetail> {
    const detail = await this.detail(user, groupId);
    if (!detail.canModerate) throw forbidden();
    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: targetUserId } },
    });
    if (!membership || membership.status !== 'PENDING') {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'No pending request for this user',
      });
    }
    await this.prisma.groupMember.update({
      where: { id: membership.id },
      data: { status: 'ACTIVE' },
    });
    this.events.emit({
      type: 'community.membership_decided',
      scope: 'GROUP',
      targetId: groupId,
      targetName: detail.name,
      memberUserId: targetUserId,
      approved: true,
    });
    return this.detail(user, groupId);
  }
}
