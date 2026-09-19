import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AuditService } from '../audit/audit.service';
import { renderMail, type MailTemplate } from './templates';

/**
 * M12-W1 — email foundation.
 *
 * Feature-flagged exactly like Google OIDC: SMTP_URL + MAIL_FROM configured
 * as an all-or-none pair (validated in config/env.ts). Unconfigured →
 * NoopMailTransport and zero behavior change.
 *
 * Guarantees:
 *  - Mail failure NEVER fails the underlying business operation
 *    (send() catches everything and audits mail.failed).
 *  - Raw tokens/URLs, SMTP credentials and message bodies are never
 *    logged or audited — audit metadata is {template, targetUserId} only.
 *  - Recipient addresses always come from the tenant-scoped User row at
 *    the action site, never from client input at send time.
 *  - Tests override MAIL_TRANSPORT with a capturing fake; no real SMTP.
 */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailTransport {
  deliver(mail: OutgoingMail): Promise<void>;
}

@Injectable()
export class SmtpMailTransport implements MailTransport {
  private transporter: Transporter | null = null;

  async deliver(mail: OutgoingMail): Promise<void> {
    if (!this.transporter) {
      this.transporter = createTransport(process.env.SMTP_URL);
    }
    await this.transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
  }
}

export interface MailRecipient {
  id: string;
  collegeId: string;
  email: string;
}

/** Strips header-injection characters from interpolated values. */
function sanitize(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    private readonly audit: AuditService,
  ) {}

  isConfigured(): boolean {
    return Boolean(process.env.SMTP_URL && process.env.MAIL_FROM);
  }

  /** Absolute web link base: APP_BASE_URL, falling back to OAUTH_REDIRECT_BASE. */
  baseUrl(): string | null {
    return process.env.APP_BASE_URL ?? process.env.OAUTH_REDIRECT_BASE ?? null;
  }

  absoluteUrl(path: string): string {
    const base = this.baseUrl();
    return base ? `${base}${path}` : path;
  }

  /**
   * Fire-and-forget transactional send. Never throws; the caller's
   * business operation is unaffected by delivery problems.
   */
  async send(recipient: MailRecipient, template: MailTemplate): Promise<void> {
    if (!this.isConfigured()) return; // feature off — silent no-op

    const sanitized = Object.fromEntries(
      Object.entries(template).map(([key, value]) => [
        key,
        typeof value === 'string' && key !== 'kind' && !key.endsWith('Url')
          ? sanitize(value)
          : value,
      ]),
    ) as MailTemplate;

    try {
      const rendered = renderMail(sanitized);
      await this.transport.deliver({
        to: recipient.email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
      await this.audit.log({
        collegeId: recipient.collegeId,
        actorId: null,
        action: 'mail.sent',
        targetType: 'User',
        targetId: recipient.id,
        metadata: { template: template.kind },
      });
    } catch (error) {
      // No message content, URLs or credentials in logs — class name only.
      this.logger.warn(
        `Mail delivery failed (template=${template.kind}): ${
          error instanceof Error ? error.name : 'unknown error'
        }`,
      );
      await this.audit.log({
        collegeId: recipient.collegeId,
        actorId: null,
        action: 'mail.failed',
        targetType: 'User',
        targetId: recipient.id,
        metadata: { template: template.kind },
      });
    }
  }
}

@Global()
@Module({
  providers: [
    MailService,
    { provide: MAIL_TRANSPORT, useClass: SmtpMailTransport },
  ],
  exports: [MailService],
})
export class MailModule {}
