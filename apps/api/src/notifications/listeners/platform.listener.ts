import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type {
  AnnouncementPublishedEvent,
  AssignmentDueSoonEvent,
  EventReminderEvent,
  ModerationActionTakenEvent,
} from '@campusos/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AnnouncementsService } from '../../announcements/announcements.module-parts';
import { renderTemplate } from '../templates';

/** M8 listeners: moderation, announcements, scheduled reminders. */
@Injectable()
export class PlatformListener {
  private readonly logger = new Logger(PlatformListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly announcements: AnnouncementsService,
  ) {}

  @OnEvent('moderation.action_taken')
  async onModerationAction(event: ModerationActionTakenEvent): Promise<void> {
    try {
      const template = renderTemplate(event);
      if (!template) return;
      await this.prisma.notification.create({
        data: {
          userId: event.targetUserId,
          type: event.type,
          title: template.title,
          body: template.body,
          linkPath: template.linkPath,
        },
      });
    } catch (error) {
      this.logger.error('moderation notification failed', String(error));
    }
  }

  @OnEvent('announcement.published')
  async onAnnouncement(event: AnnouncementPublishedEvent): Promise<void> {
    try {
      const template = renderTemplate(event);
      if (!template) return;
      const announcement = await this.prisma.announcement.findUnique({
        where: { id: event.announcementId },
        select: { collegeId: true, authorId: true },
      });
      if (!announcement) return;
      const audience = await this.announcements.resolveAudience(
        announcement.collegeId,
        event.audienceScope,
        event.audienceIds,
      );
      const recipients = audience.filter((id) => id !== announcement.authorId);
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
      this.logger.error('announcement notification failed', String(error));
    }
  }

  @OnEvent('assignment.due_soon')
  async onDueSoon(event: AssignmentDueSoonEvent): Promise<void> {
    try {
      const template = renderTemplate(event);
      if (!template || event.studentUserIds.length === 0) return;
      await this.prisma.notification.createMany({
        data: event.studentUserIds.map((userId) => ({
          userId,
          type: event.type,
          title: template.title,
          body: template.body,
          linkPath: template.linkPath,
        })),
      });
    } catch (error) {
      this.logger.error('due-soon notification failed', String(error));
    }
  }

  @OnEvent('event.reminder')
  async onEventReminder(event: EventReminderEvent): Promise<void> {
    try {
      const template = renderTemplate(event);
      if (!template || event.attendeeUserIds.length === 0) return;
      await this.prisma.notification.createMany({
        data: event.attendeeUserIds.map((userId) => ({
          userId,
          type: event.type,
          title: template.title,
          body: template.body,
          linkPath: template.linkPath,
        })),
      });
    } catch (error) {
      this.logger.error('event reminder failed', String(error));
    }
  }
}
