import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { InvoiceIssuedEvent, InvoiceOverdueEvent } from '@campusos/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { renderTemplate } from '../templates';

/** Fee notification listeners (Blueprint §10, M6). */
@Injectable()
export class FeesListener {
  private readonly logger = new Logger(FeesListener.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('invoice.issued')
  async onIssued(event: InvoiceIssuedEvent): Promise<void> {
    await this.create(event.studentUserId, event);
  }

  @OnEvent('invoice.overdue')
  async onOverdue(event: InvoiceOverdueEvent): Promise<void> {
    await this.create(event.studentUserId, event);
  }

  private async create(
    userId: string,
    event: InvoiceIssuedEvent | InvoiceOverdueEvent,
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
      this.logger.error(
        'Failed to create fee notification',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
