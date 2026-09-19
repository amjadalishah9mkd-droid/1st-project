import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type {
  AssignmentGradedEvent,
  AssignmentPublishedEvent,
} from '@campusos/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { renderTemplate } from '../templates';

/** Assignment notification listeners (Blueprint §10, M4). */
@Injectable()
export class AssignmentsListener {
  private readonly logger = new Logger(AssignmentsListener.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('assignment.published')
  async onPublished(event: AssignmentPublishedEvent): Promise<void> {
    try {
      const template = renderTemplate(event);
      if (!template) return;
      // Fan out to the section's active roster.
      const enrollments = await this.prisma.enrollment.findMany({
        where: { sectionId: event.sectionId, status: 'ACTIVE' },
        select: { student: { select: { userId: true } } },
      });
      if (enrollments.length === 0) return;
      await this.prisma.notification.createMany({
        data: enrollments.map((enrollment) => ({
          userId: enrollment.student.userId,
          type: event.type,
          title: template.title,
          body: template.body,
          linkPath: template.linkPath,
        })),
      });
    } catch (error) {
      this.logger.error(
        'Failed to create publish notifications',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  @OnEvent('assignment.graded')
  async onGraded(event: AssignmentGradedEvent): Promise<void> {
    try {
      const template = renderTemplate(event);
      if (!template) return;
      await this.prisma.notification.create({
        data: {
          userId: event.studentUserId,
          type: event.type,
          title: template.title,
          body: template.body,
          linkPath: template.linkPath,
        },
      });
    } catch (error) {
      this.logger.error(
        'Failed to create grade notification',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
