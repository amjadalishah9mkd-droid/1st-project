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
    }
  // M12-W2 — notification channel (respects User.emailOptOut upstream).
  | { kind: 'results_published'; firstName: string; examTitle: string; url: string }
  | {
      kind: 'invoice_issued';
      firstName: string;
      amount: string;
      dueDate: string;
      url: string;
    }
  | {
      kind: 'invoice_overdue';
      firstName: string;
      amount: string;
      dueDate: string;
      url: string;
    }
  // M14-W3 — online payment outcomes (invoiceNo + amount only; no card
  // data, provider tokens or payloads ever reach mail).
  | {
      kind: 'payment_succeeded';
      firstName: string;
      amount: string;
      invoiceNo: string;
      url: string;
    }
  | {
      kind: 'payment_failed';
      firstName: string;
      amount: string;
      invoiceNo: string;
      url: string;
    }
  | { kind: 'announcement'; firstName: string; title: string; url: string }
  // M13-W2 — guardian onboarding (H3: child shown as "FirstName L.").
  | {
      kind: 'guardian_invite';
      firstName: string;
      collegeName: string;
      studentName: string;
      inviteUrl: string;
      expiresAt: string;
    }
  | {
      kind: 'guardian_link_added';
      firstName: string;
      collegeName: string;
      studentName: string;
      url: string;
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
    case 'results_published':
      return {
        subject: `Results published: ${template.examTitle}`,
        ...layout([
          `Hi ${template.firstName},`,
          `Results for "${template.examTitle}" are now available in CampusOS.`,
          template.url,
        ]),
      };
    case 'invoice_issued':
      return {
        subject: 'New fee invoice',
        ...layout([
          `Hi ${template.firstName},`,
          `A fee invoice of ${template.amount} is due by ${template.dueDate}.`,
          template.url,
        ]),
      };
    case 'invoice_overdue':
      return {
        subject: 'Fee invoice overdue',
        ...layout([
          `Hi ${template.firstName},`,
          `An invoice of ${template.amount} was due on ${template.dueDate} and is now overdue.`,
          template.url,
        ]),
      };
    case 'payment_succeeded':
      return {
        subject: 'Payment received',
        ...layout([
          `Hi ${template.firstName},`,
          `Your online payment of ${template.amount} for invoice ${template.invoiceNo} was received. Thank you.`,
          template.url,
        ]),
      };
    case 'payment_failed':
      return {
        subject: 'Payment failed',
        ...layout([
          `Hi ${template.firstName},`,
          `Your online payment of ${template.amount} for invoice ${template.invoiceNo} could not be completed. No money was recorded — you can try again from your fees page.`,
          template.url,
        ]),
      };
    case 'announcement':
      return {
        subject: `Announcement: ${template.title}`,
        ...layout([
          `Hi ${template.firstName},`,
          `A new announcement was published: "${template.title}".`,
          template.url,
        ]),
      };
    case 'guardian_invite':
      return {
        subject: `Activate your ${template.collegeName} guardian account`,
        ...layout([
          `Hi ${template.firstName},`,
          `${template.collegeName} has added you as a guardian of ${template.studentName}. Use the link below to activate your CampusOS guardian account.`,
          template.inviteUrl,
          `This one-time link expires ${fmt(template.expiresAt)}.`,
        ]),
      };
    case 'guardian_link_added':
      return {
        subject: `You now have guardian access for ${template.studentName}`,
        ...layout([
          `Hi ${template.firstName},`,
          `${template.collegeName} has linked ${template.studentName} to your existing CampusOS guardian account. Sign in to view their information.`,
          template.url,
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
