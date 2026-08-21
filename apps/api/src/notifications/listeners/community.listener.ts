import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type {
  CommunityCommentEvent,
  CommunityLikeEvent,
  EventCreatedEvent,
  GroupRequestEvent,
  MembershipDecidedEvent,
} from '@campusos/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { renderTemplate } from '../templates';

/** Community notification listeners (Blueprint §10, M7). */
@Injectable()
export class CommunityListener {
  private readonly logger = new Logger(CommunityListener.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('community.comment')
  async onComment(event: CommunityCommentEvent): Promise<void> {
    await this.safeCreate(event.targetOwnerUserId, event);
  }

  /** Likes are collapsed: max one like notification per post per hour. */
  @OnEvent('community.like')
  async onLike(event: CommunityLikeEvent): Promise<void> {
    try {
      const recent = await this.prisma.notification.findFirst({
        where: {
          userId: event.targetOwnerUserId,
          type: 'community.like',
          linkPath: `/community?post=${event.postId}`,
          createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
        },
      });
      if (recent) return;
      await this.safeCreate(event.targetOwnerUserId, event);
    } catch (error) {
      this.logger.error('like notification failed', String(error));
    }
  }

  @OnEvent('community.group_request')
  async onGroupRequest(event: GroupRequestEvent): Promise<void> {
    try {
      const template = renderTemplate(event);
      if (!template || event.moderatorUserIds.length === 0) return;
      await this.prisma.notification.createMany({
        data: event.moderatorUserIds.map((userId) => ({
          userId,
          type: event.type,
          title: template.title,
          body: template.body,
          linkPath: template.linkPath,
        })),
      });
    } catch (error) {
      this.logger.error('group request notification failed', String(error));
    }
  }

  @OnEvent('community.membership_decided')
  async onMembershipDecided(event: MembershipDecidedEvent): Promise<void> {
    await this.safeCreate(event.memberUserId, event);
  }

  /** Event fan-out: society members, or every active user for campus-wide. */
  @OnEvent('event.created')
  async onEventCreated(event: EventCreatedEvent): Promise<void> {
    try {
      const template = renderTemplate(event);
      if (!template) return;
      const eventRow = await this.prisma.event.findUnique({
        where: { id: event.eventId },
        select: { collegeId: true, createdById: true },
      });
      if (!eventRow) return;

      let userIds: string[];
      if (event.societyId) {
        const members = await this.prisma.societyMember.findMany({
          where: { societyId: event.societyId, status: 'ACTIVE' },
          select: { userId: true },
        });
        userIds = members.map((m) => m.userId);
      } else {
        const users = await this.prisma.user.findMany({
          where: { collegeId: eventRow.collegeId, status: 'ACTIVE' },
          select: { id: true },
        });
        userIds = users.map((u) => u.id);
      }
      const recipients = userIds.filter((id) => id !== eventRow.createdById);
      if (recipients.length === 0) return;
      await this.prisma.notification.createMany({
        data: recipients.map((userId) => ({
          userId,
          type: event.type,
          title: template.title,
          body: template.body,
          linkPath: template.linkPath,
        })),
      });
    } catch (error) {
      this.logger.error('event notification failed', String(error));
    }
  }

  private async safeCreate(
    userId: string,
    event:
      | CommunityCommentEvent
      | CommunityLikeEvent
      | MembershipDecidedEvent,
  ): Promise<void> {
    try {
      const template = renderTemplate(event);
      if (!template) return;
      await this.prisma.notification.create({
        data: {
          userId,
          type: event.type,
          title: template.title,
          body: template.body,
          linkPath: template.linkPath,
        },
      });
    } catch (error) {
      this.logger.error('community notification failed', String(error));
    }
  }
}
