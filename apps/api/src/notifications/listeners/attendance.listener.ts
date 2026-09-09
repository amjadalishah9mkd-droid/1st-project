import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { AttendanceMarkedAbsentEvent } from '@campusos/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { renderTemplate } from '../templates';

/**
 * Attendance notification listener (Blueprint §10, M3).
 * Creates real Notification rows when a student is marked absent. The
 * notification inbox UI ships in M8; the unread counter in /me already
 * reads these rows.
 */
@Injectable()
export class AttendanceListener {
  private readonly logger = new Logger(AttendanceListener.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('attendance.marked_absent')
  async onMarkedAbsent(event: AttendanceMarkedAbsentEvent): Promise<void> {
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
      // Notification failure must never break the attendance flow.
      this.logger.error(
        'Failed to create absence notification',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
