import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { VerificationDecidedEvent } from '@campusos/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { renderTemplate } from '../templates';
import { MailService } from '../../mail/mail.module';

/**
 * M11-W3 — verification decision notifications.
 * Decisions are atomic one-time transitions (PENDING → decided), so a
 * retried decision fails before reaching the event bus — notifications are
 * deduplicated by construction.
 */
@Injectable()
export class VerificationListener {
  private readonly logger = new Logger(VerificationListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

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

      // M12-W1: decision email. Exactly-once is inherited from the atomic
      // claim transitions upstream; mail failure never affects the flow.
      const user = await this.prisma.user.findUnique({
        where: { id: event.userId },
        select: { id: true, collegeId: true, email: true, firstName: true },
      });
      if (user) {
        await this.mail.send(
          { id: user.id, collegeId: user.collegeId, email: user.email },
          event.type === 'verification.approved'
            ? {
                kind: 'verification_approved',
                firstName: user.firstName,
                loginUrl: this.mail.absoluteUrl('/dashboard'),
              }
            : {
                kind: 'verification_rejected',
                firstName: user.firstName,
                reason: event.rejectionReason ?? null,
                verifyUrl: this.mail.absoluteUrl('/verify'),
              },
        );
      }
    } catch (error) {
      this.logger.error(
        'Failed to create verification notification',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
