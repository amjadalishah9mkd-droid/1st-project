import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { VerificationDecidedEvent } from '@campusos/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { renderTemplate } from '../templates';

/**
 * M11-W3 — verification decision notifications.
 * Decisions are atomic one-time transitions (PENDING → decided), so a
 * retried decision fails before reaching the event bus — notifications are
 * deduplicated by construction.
 */
@Injectable()
export class VerificationListener {
  private readonly logger = new Logger(VerificationListener.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('verification.approved')
  @OnEvent('verification.rejected')
  async onDecision(event: VerificationDecidedEvent): Promise<void> {
    try {
      const template = renderTemplate(event);
      if (!template) return;
      await this.prisma.notification.create({
        data: {
          userId: event.userId,
          type: event.type,
          title: template.title,
          body: template.body,
          linkPath: template.linkPath,
        },
      });
    } catch (error) {
      this.logger.error(
        'Failed to create verification notification',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
