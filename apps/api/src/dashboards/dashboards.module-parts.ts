import { Controller, Get, Injectable } from '@nestjs/common';
import { netPaid } from '../fees/money';
import {
  PERMISSIONS,
  type AdminDashboard,
  type StudentDashboard,
  type TeacherDashboard,
  type TodaySessionInfo,
} from '@campusos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

function todayUtc(): { start: Date; end: Date; dayOfWeek: number } {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const jsDay = start.getUTCDay(); // 0=Sun
  return { start, end, dayOfWeek: jsDay === 0 ? 7 : jsDay };
}

function rate(present: number, total: number): number | null {
  return total > 0 ? Math.round((present / total) * 1000) / 10 : null;
}

/**
 * Role dashboards (Blueprint §7, M9). Read-only aggregations over live data
 * — every number is a real query, scoped exactly like the owning modules.
 */
@Injectable()
export class DashboardsService {
  constructor(private readonly prisma: PrismaService) {}

  private async todaySessionsForSections(
    sectionIds: string[],
  ): Promise<TodaySessionInfo[]> {
    if (sectionIds.length === 0) return [];
    const { start, end, dayOfWeek } = todayUtc();
    const slots = await this.prisma.timetableSlot.findMany({
      where: { sectionId: { in: sectionIds }, dayOfWeek },
      include: {
        section: {
          select: { id: true, name: true, room: true, course: { select: { code: true } } },
        },
        sessions: { where: { date: { gte: start, lt: end } }, take: 1 },
      },
      orderBy: { startTime: 'asc' },
    });
    return slots.map((slot) => {
      const session = slot.sessions[0];
      return {
        sessionId: session?.id ?? null,
        sectionId: slot.section.id,
        sectionLabel: `${slot.section.course.code} — Section ${slot.section.name}`,
        startTime: slot.startTime,
        endTime: slot.endTime,
        room: slot.room ?? slot.section.room,
        status: session ? session.status : 'NOT_GENERATED',
      };
    });
  }

  private async attendanceRateFor(sessionFilter: object): Promise<number | null> {
    const [total, present] = await this.prisma.$transaction([
      this.prisma.attendanceRecord.count({
        where: { session: { status: 'HELD', ...sessionFilter } },
      }),
      this.prisma.attendanceRecord.count({
        where: {
          session: { status: 'HELD', ...sessionFilter },
          status: { in: ['PRESENT', 'LATE'] },
        },
      }),
    ]);
    return rate(present, total);
  }

  async admin(user: AuthenticatedUser): Promise<AdminDashboard> {
    const collegeId = user.collegeId;
    const [
      students,
      teachers,
      courses,
      sections,
      openReports,
      upcomingEvents,
      publishedExams,
      currentTerm,
      invoices,
    ] = await this.prisma.$transaction([
      this.prisma.studentProfile.count({ where: { collegeId } }),
      this.prisma.teacherProfile.count({ where: { collegeId } }),
      this.prisma.course.count({ where: { collegeId, status: 'ACTIVE' } }),
      this.prisma.section.count({ where: { collegeId } }),
      this.prisma.report.count({
        where: { collegeId, status: { in: ['OPEN', 'REVIEWING'] } },
      }),
      this.prisma.event.count({
        where: { collegeId, status: 'ACTIVE', startsAt: { gt: new Date() } },
      }),
      this.prisma.exam.count({ where: { collegeId, status: 'PUBLISHED' } }),
      this.prisma.term.findFirst({
        where: { collegeId, isCurrent: true },
        select: { label: true },
      }),
      this.prisma.invoice.findMany({
        where: { collegeId, status: { not: 'CANCELLED' } },
        include: {
          payments: { select: { amount: true } },
          refunds: { select: { amount: true } },
        },
      }),
    ]);

    let invoiced = 0;
    let collected = 0;
    let overdueCount = 0;
    for (const invoice of invoices) {
      invoiced += Number(invoice.amount);
      // M17-W2 (DEFECT-1 fix): collected is NET of settled refunds.
      collected += netPaid(invoice);
      if (invoice.status === 'OVERDUE') overdueCount += 1;
    }

    return {
      students,
      teachers,
      courses,
      sections,
      attendanceRate: await this.attendanceRateFor({
        section: { collegeId },
      }),
      fees: {
        invoiced: String(invoiced),
        collected: String(collected),
        outstanding: String(invoiced - collected),
        overdueCount,
      },
      openReports,
      upcomingEvents,
      publishedExams,
      currentTermLabel: currentTerm?.label ?? null,
    };
  }

  async teacher(user: AuthenticatedUser): Promise<TeacherDashboard> {
    const assignments = await this.prisma.teachingAssignment.findMany({
      where: { teacher: { userId: user.id } },
      select: { sectionId: true },
    });
    const sectionIds = assignments.map((a) => a.sectionId);

    const [students, pendingGrading, openAssignments] =
      await this.prisma.$transaction([
        this.prisma.enrollment.count({
          where: { sectionId: { in: sectionIds }, status: 'ACTIVE' },
        }),
        this.prisma.submission.count({
          where: {
            assignment: { sectionId: { in: sectionIds } },
            points: null,
          },
        }),
        this.prisma.assignment.count({
          where: {
            sectionId: { in: sectionIds },
            publishedAt: { not: null },
            dueAt: { gt: new Date() },
          },
        }),
      ]);

    return {
      sections: sectionIds.length,
      students,
      todaySessions: await this.todaySessionsForSections(sectionIds),
      pendingGrading,
      openAssignments,
      attendanceRate: await this.attendanceRateFor({
        sectionId: { in: sectionIds },
      }),
    };
  }

  async student(user: AuthenticatedUser): Promise<StudentDashboard> {
    const profile = await this.prisma.studentProfile.findFirst({
      where: { userId: user.id, collegeId: user.collegeId },
      select: { id: true },
    });
    if (!profile) {
      return {
        sections: 0,
        attendanceRate: null,
        todayClasses: [],
        pendingAssignments: [],
        feeBalance: '0',
        overdueInvoices: 0,
        publishedResults: 0,
        nextEvent: null,
      };
    }

    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentId: profile.id, status: 'ACTIVE' },
      select: { sectionId: true },
    });
    const sectionIds = enrollments.map((e) => e.sectionId);

    const [pendingAssignmentsRows, invoices, publishedResults, nextEvent, attendanceTotals] =
      await Promise.all([
        this.prisma.assignment.findMany({
          where: {
            sectionId: { in: sectionIds },
            publishedAt: { not: null },
            dueAt: { gt: new Date() },
            submissions: { none: { studentId: profile.id } },
          },
          include: { section: { select: { course: { select: { code: true } } } } },
          orderBy: { dueAt: 'asc' },
          take: 5,
        }),
        this.prisma.invoice.findMany({
          where: { studentId: profile.id, status: { not: 'CANCELLED' } },
          include: {
          payments: { select: { amount: true } },
          refunds: { select: { amount: true } },
        },
        }),
        this.prisma.mark.count({
          where: {
            studentId: profile.id,
            examPaper: { exam: { status: 'PUBLISHED' } },
          },
        }),
        this.prisma.event.findFirst({
          where: {
            collegeId: user.collegeId,
            status: 'ACTIVE',
            startsAt: { gt: new Date() },
          },
          orderBy: { startsAt: 'asc' },
          select: { id: true, title: true, startsAt: true },
        }),
        this.prisma.$transaction([
          this.prisma.attendanceRecord.count({
            where: { studentId: profile.id, session: { status: 'HELD' } },
          }),
          this.prisma.attendanceRecord.count({
            where: {
              studentId: profile.id,
              session: { status: 'HELD' },
              status: { in: ['PRESENT', 'LATE'] },
            },
          }),
        ]),
      ]);

    let balance = 0;
    let overdueInvoices = 0;
    for (const invoice of invoices) {
      // M17-W2 (DEFECT-1 fix): balance derives from NET paid.
      balance += Number(invoice.amount) - netPaid(invoice);
      if (invoice.status === 'OVERDUE') overdueInvoices += 1;
    }

    return {
      sections: sectionIds.length,
      attendanceRate: rate(attendanceTotals[1], attendanceTotals[0]),
      todayClasses: await this.todaySessionsForSections(sectionIds),
      pendingAssignments: pendingAssignmentsRows.map((assignment) => ({
        id: assignment.id,
        title: assignment.title,
        courseCode: assignment.section.course.code,
        dueAt: assignment.dueAt.toISOString(),
      })),
      feeBalance: String(balance),
      overdueInvoices,
      publishedResults,
      nextEvent: nextEvent
        ? { ...nextEvent, startsAt: nextEvent.startsAt.toISOString() }
        : null,
    };
  }
}

@Controller('dashboards')
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get('admin')
  @RequirePermission(PERMISSIONS.DASHBOARD_ADMIN)
  admin(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboards.admin(user);
  }

  @Get('teacher')
  @RequirePermission(PERMISSIONS.DASHBOARD_TEACHER)
  teacher(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboards.teacher(user);
  }

  @Get('student')
  @RequirePermission(PERMISSIONS.DASHBOARD_STUDENT)
  student(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboards.student(user);
  }
}
