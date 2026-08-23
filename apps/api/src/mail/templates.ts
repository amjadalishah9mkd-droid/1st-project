/**
 * M12-W1 — transactional mail templates.
 * Mirrors the notifications template registry pattern: a typed union
 * rendered to {subject, text, html}. Plain minimal HTML — no template
 * engine dependency. Interpolated values are sanitized by MailService.
 */

export type MailTemplate =
  | {
      kind: 'student_invite';
      firstName: string;
      collegeName: string;
      inviteUrl: string; // absolute
      expiresAt: string; // ISO
    }
  | {
      kind: 'teacher_invite';
      firstName: string;
      collegeName: string;
      inviteUrl: string;
      expiresAt: string;
    }
  | {
      kind: 'password_reset';
      firstName: string;
      resetUrl: string;
      expiresAt: string;
    }
  | { kind: 'verification_approved'; firstName: string; loginUrl: string }
  | {
      kind: 'verification_rejected';
      firstName: string;
      reason: string | null;
      verifyUrl: string;
    };

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

function fmt(iso: string): string {
  return new Date(iso).toUTCString();
}

function layout(lines: string[]): { text: string; html: string } {
  const text = lines.join('\n\n');
  const html = `<div style="font-family:sans-serif;max-width:560px">${lines
    .map((line) =>
      line.startsWith('http')
        ? `<p><a href="${line}">${line}</a></p>`
        : `<p>${line}</p>`,
    )
    .join('')}<p style="color:#888;font-size:12px">CampusOS — this link is personal; do not forward it.</p></div>`;
  return { text, html };
}

export function renderMail(template: MailTemplate): RenderedMail {
  switch (template.kind) {
    case 'student_invite':
      return {
        subject: `Activate your ${template.collegeName} student account`,
        ...layout([
          `Hi ${template.firstName},`,
          `${template.collegeName} has created a CampusOS student account for you. Use the link below to activate it.`,
          template.inviteUrl,
          `This one-time link expires ${fmt(template.expiresAt)}.`,
        ]),
      };
    case 'teacher_invite':
      return {
        subject: `Activate your ${template.collegeName} staff account`,
        ...layout([
          `Hi ${template.firstName},`,
          `${template.collegeName} has created a CampusOS account for you. Use the link below to set your password.`,
          template.inviteUrl,
          `This one-time link expires ${fmt(template.expiresAt)}.`,
        ]),
      };
    case 'password_reset':
      return {
        subject: 'Reset your CampusOS password',
        ...layout([
          `Hi ${template.firstName},`,
          'A password reset link was issued for your CampusOS account. If you did not request this, contact your college administration.',
          template.resetUrl,
          `This one-time link expires ${fmt(template.expiresAt)}.`,
        ]),
      };
    case 'verification_approved':
      return {
        subject: 'Your student identity has been verified',
        ...layout([
          `Hi ${template.firstName},`,
          'Your student identity has been verified. Your CampusOS account now has full access.',
          template.loginUrl,
        ]),
      };
    case 'verification_rejected':
      return {
        subject: 'Update on your identity verification',
        ...layout([
          `Hi ${template.firstName},`,
          template.reason
            ? `Your identity claim was not approved: ${template.reason}`
            : 'Your identity claim was not approved.',
          'You can review the details and submit a new claim here:',
          template.verifyUrl,
        ]),
      };
  }
}
