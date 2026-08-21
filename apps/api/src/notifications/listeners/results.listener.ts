import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ResultsPublishedEvent } from '@campusos/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { renderTemplate } from '../templates';

/** Results notification listener (Blueprint §10, M5). */
@Injectable()
export class ResultsListener {
  private readonly logger = new Logger(ResultsListener.name);

  constructor(private readonly prisma: PrismaService) {}

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
    } catch (error) {
      this.logger.error(
        'Failed to create results notifications',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
