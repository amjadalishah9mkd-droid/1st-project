import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.module';

/**
 * Scheduled notification sweeps (Blueprint §10):
 *  - assignment.due_soon  — published assignments due within 24h, unsubmitted
 *  - invoice.overdue      — invoices that have become OVERDUE
 *  - event.reminder       — events starting within 24h, to GOING/INTERESTED
 * Each sweep is idempotent: recipients already notified for the same object
 * (deduplicated by type + linkPath) are skipped. Runs daily at 06:00; the
 * methods are also directly callable (tests, manual runs).
 */
@Injectable()
export class NotificationSchedulerService {
  private readonly logger = new Logger(NotificationSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async runDailySweeps(): Promise<void> {
    try {
      await this.sweepDueSoonAssignments();
      await this.sweepOverdueInvoices();
      await this.sweepEventReminders();
      this.logger.log('Daily notification sweeps complete');
    } catch (error) {
      this.logger.error('Daily sweep failed', String(error));
    }
  }

  private async alreadyNotified(
    userIds: string[],
    type: string,
    linkPath: string,
  ): Promise<Set<string>> {
    const rows = await this.prisma.notification.findMany({
      where: { userId: { in: userIds }, type, linkPath },
      select: { userId: true },
    });
    return new Set(rows.map((row) => row.userId));
  }

  async sweepDueSoonAssignments(): Promise<number> {
    const now = new Date();
    const cutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const assignments = await this.prisma.assignment.findMany({
      where: { publishedAt: { not: null }, dueAt: { gt: now, lte: cutoff } },
      include: {
        section: {
          include: {
            enrollments: {
              where: { status: 'ACTIVE' },
              select: { studentId: true, student: { select: { userId: true } } },
            },
          },
        },
        submissions: { select: { studentId: true } },
      },
    });

    let emitted = 0;
    for (const assignment of assignments) {
      const submitted = new Set(assignment.submissions.map((s) => s.studentId));
      const pending = assignment.section.enrollments.filter(
        (enrollment) => !submitted.has(enrollment.studentId),
      );
      const userIds = pending.map((enrollment) => enrollment.student.userId);
      if (userIds.length === 0) continue;
      const linkPath = `/assignments/${assignment.id}`;
      const notified = await this.alreadyNotified(
        userIds,
        'assignment.due_soon',
        linkPath,
      );
      const targets = userIds.filter((id) => !notified.has(id));
      if (targets.length === 0) continue;
      this.events.emit({
        type: 'assignment.due_soon',
        assignmentId: assignment.id,
        title: assignment.title,
        dueAt: assignment.dueAt.toISOString(),
        studentUserIds: targets,
      });
      emitted += targets.length;
    }
    return emitted;
  }

  async sweepOverdueInvoices(): Promise<number> {
    // Real status transition first (same rule the fees module applies on read).
    await this.prisma.invoice.updateMany({
      where: {
        status: { in: ['PENDING', 'PARTIAL'] },
        dueDate: { lt: new Date() },
      },
      data: { status: 'OVERDUE' },
    });
    const invoices = await this.prisma.invoice.findMany({
      where: { status: 'OVERDUE' },
      include: { student: { select: { userId: true } } },
    });
    let emitted = 0;
    for (const invoice of invoices) {
      const linkPath = `/fees/invoices/${invoice.id}`;
      const notified = await this.alreadyNotified(
        [invoice.student.userId],
        'invoice.overdue',
        linkPath,
      );
      if (notified.size > 0) continue;
      this.events.emit({
        type: 'invoice.overdue',
        studentUserId: invoice.student.userId,
        invoiceId: invoice.id,
        amount: invoice.amount.toString(),
        dueDate: invoice.dueDate.toISOString().slice(0, 10),
      });
      emitted += 1;
    }
    return emitted;
  }

  async sweepEventReminders(): Promise<number> {
    const now = new Date();
    const cutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const events = await this.prisma.event.findMany({
      where: { status: 'ACTIVE', startsAt: { gt: now, lte: cutoff } },
      include: {
        rsvps: {
          where: { status: { in: ['GOING', 'INTERESTED'] } },
          select: { userId: true },
        },
      },
    });
    let emitted = 0;
    for (const event of events) {
      const userIds = event.rsvps.map((rsvp) => rsvp.userId);
      if (userIds.length === 0) continue;
      const linkPath = `/community/events?event=${event.id}`;
      const notified = await this.alreadyNotified(
        userIds,
        'event.reminder',
        linkPath,
      );
      const targets = userIds.filter((id) => !notified.has(id));
      if (targets.length === 0) continue;
      this.events.emit({
        type: 'event.reminder',
        eventId: event.id,
        title: event.title,
        startsAt: event.startsAt.toISOString(),
        attendeeUserIds: targets,
      });
      emitted += targets.length;
    }
    return emitted;
  }
}
