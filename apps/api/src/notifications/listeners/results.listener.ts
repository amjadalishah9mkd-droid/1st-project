import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ResultsPublishedEvent } from '@campusos/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { renderTemplate } from '../templates';
import { NotificationMailerService } from '../notification-mailer.service';

/** Results notification listener (Blueprint §10, M5). */
@Injectable()
export class ResultsListener {
  private readonly logger = new Logger(ResultsListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: NotificationMailerService,
  ) {}

  @OnEvent('results.published')
  async onPublished(event: ResultsPublishedEvent): Promise<void> {
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
      // M12-W2 — email channel (opt-out respected in the mailer).
      // F4: collegeId anchored to the exam aggregate, not the user ids.
      const exam = await this.prisma.exam.findUnique({
        where: { id: event.examId },
        select: { collegeId: true },
      });
      if (exam) {
        await this.mailer.sendToUsers(
          exam.collegeId,
          event.studentUserIds,
          ({ firstName }) => ({
            kind: 'results_published',
            firstName,
            examTitle: event.examTitle,
            url: this.mailer.absoluteUrl(template.linkPath ?? '/results'),
          }),
        );
      }
    } catch (error) {
      this.logger.error(
        'Failed to create results notifications',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
