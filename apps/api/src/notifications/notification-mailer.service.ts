import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.module';
import type { MailTemplate } from '../mail/templates';

/**
 * M12-W2 — notification email channel.
 *
 * Thin recipient-resolution layer over the W1 MailService. Rules:
 *  - Recipients are always re-fetched from the database by user id
 *    (tenant-scoped rows carry their own collegeId/email) — never from
 *    client-supplied addresses.
 *  - Users with emailOptOut=true are filtered here. Transactional mail
 *    (invites, resets, verification decisions) does NOT go through this
 *    service and therefore always ignores the opt-out.
 *  - Delivery mechanics (Noop when unconfigured, fire-and-forget,
 *    mail.sent/mail.failed audits) live entirely in MailService.
 *  - In-app notifications are written by the listeners BEFORE this runs
 *    and are never affected by email configuration or failures.
 */
@Injectable()
export class NotificationMailerService {
  private readonly logger = new Logger(NotificationMailerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  absoluteUrl(path: string): string {
    return this.mail.absoluteUrl(path);
  }

  async sendToUsers(
    userIds: string[],
    template: (user: { firstName: string }) => Exclude<
      MailTemplate,
      { kind: `${'student' | 'teacher'}_invite` | 'password_reset' }
    >,
  ): Promise<void> {
    if (userIds.length === 0 || !this.mail.isConfigured()) return;
    try {
      const recipients = await this.prisma.user.findMany({
        where: { id: { in: userIds }, emailOptOut: false, status: 'ACTIVE' },
        select: {
          id: true,
          collegeId: true,
          email: true,
          firstName: true,
        },
      });
      for (const user of recipients) {
        await this.mail.send(
          { id: user.id, collegeId: user.collegeId, email: user.email },
          template({ firstName: user.firstName }),
        );
      }
    } catch (error) {
      // Never let mail resolution affect the notification flow.
      this.logger.warn(
        `Notification mail dispatch failed: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    }
  }
}
