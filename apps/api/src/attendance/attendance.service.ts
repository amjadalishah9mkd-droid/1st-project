import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AttendanceSheet,
  AttendanceSummaryResponse,
  SaveAttendanceInput,
  SessionItem,
  UpdateSessionInput,
} from '@campusos/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../access/policy.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.module';
import type { AuthenticatedUser } from '../access/authenticated-user';

const sessionInclude = {
  slot: { select: { dayOfWeek: true, startTime: true, endTime: true, room: true } },
  takenBy: { select: { firstName: true, lastName: true } },
  section: {
    select: {
      room: true,
      _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
    },
  },
  _count: { select: { attendanceRecords: true } },
} satisfies Prisma.ClassSessionInclude;

type SessionRecord = Prisma.ClassSessionGetPayload<{
  include: typeof sessionInclude;
}> & { absentCount?: number };

function toSessionItem(row: SessionRecord, absentCount = 0): SessionItem {
  return {
    id: row.id,
    slotId: row.slotId,
    sectionId: row.sectionId,
    date: row.date.toISOString().slice(0, 10),
    dayOfWeek: row.slot.dayOfWeek,
    startTime: row.slot.startTime,
    endTime: row.slot.endTime,
    room: row.slot.room ?? row.section.room,
    status: row.status,
    note: row.note,
    takenByName: row.takenBy
      ? `${row.takenBy.firstName} ${row.takenBy.lastName}`
      : null,
    recordedCount: row._count.attendanceRecords,
    enrolledCount: row.section._count.enrollments,
    absentCount,
  };
}

function forbidden(): ForbiddenException {
  return new ForbiddenException({
    code: 'FORBIDDEN',
    message: 'You do not have permission to perform this action',
  });
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  // ── Session generation & listing ───────────────────────────

  /**
   * Idempotently creates ClassSession rows for every slot of the section in
   * the week containing `weekOf` (Blueprint §7). Dates outside the term are
   * rejected.
   */
  async generateSessions(
    user: AuthenticatedUser,
    sectionId: string,
    weekOf: string,
  ): Promise<{ created: number; sessions: SessionItem[] }> {
    const section = await this.requireSection(user, sectionId);
    if (!(await this.policy.can(user, 'attendance.record', { sectionId }))) {
      throw forbidden();
    }

    const monday = mondayOf(new Date(`${weekOf}T00:00:00Z`));
    const weekEnd = addDays(monday, 6);
    if (weekEnd < section.term.startsOn || monday > section.term.endsOn) {
      throw new BadRequestException({
        code: 'OUTSIDE_TERM',
        message: `That week is outside ${section.term.label} (${iso(section.term.startsOn)} – ${iso(section.term.endsOn)})`,
      });
    }

    const slots = await this.prisma.timetableSlot.findMany({
      where: { sectionId },
    });
    if (slots.length === 0) {
      throw new BadRequestException({
        code: 'NO_SLOTS',
        message: 'This section has no timetable slots yet',
      });
    }

    const data = slots
      .map((slot) => ({
        slotId: slot.id,
        sectionId,
        date: addDays(monday, slot.dayOfWeek - 1),
      }))
      .filter(
        (entry) =>
          entry.date >= section.term.startsOn && entry.date <= section.term.endsOn,
      );

    const result = await this.prisma.classSession.createMany({
      data,
      skipDuplicates: true, // idempotency via @@unique([slotId, date])
    });

    const sessions = await this.listSessions(user, sectionId, {
      from: iso(monday),
      to: iso(weekEnd),
    });
    return { created: result.count, sessions };
  }

  async listSessions(
    user: AuthenticatedUser,
    sectionId: string,
    range: { from?: string; to?: string },
  ): Promise<SessionItem[]> {
    await this.requireSection(user, sectionId);
    const readScope = await this.policy.scopeFor(user, 'attendance.read');
    if (!readScope) throw forbidden();
    if (readScope === 'ASSIGNED') {
      const allowed = await this.policy.can(user, 'attendance.read', { sectionId });
      if (!allowed) throw forbidden();
    } else if (readScope === 'OWN') {
      const enrolled = await this.prisma.enrollment.findFirst({
        where: { sectionId, student: { userId: user.id }, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!enrolled) throw forbidden();
    }

    const rows = await this.prisma.classSession.findMany({
      where: {
        sectionId,
        ...(range.from ? { date: { gte: new Date(`${range.from}T00:00:00Z`) } } : {}),
        ...(range.to
          ? {
              date: {
                ...(range.from ? { gte: new Date(`${range.from}T00:00:00Z`) } : {}),
                lte: new Date(`${range.to}T00:00:00Z`),
              },
            }
          : {}),
      },
      include: sessionInclude,
      orderBy: [{ date: 'asc' }, { slot: { startTime: 'asc' } }],
    });

    const absents = await this.prisma.attendanceRecord.groupBy({
      by: ['sessionId'],
      where: { sessionId: { in: rows.map((r) => r.id) }, status: 'ABSENT' },
      _count: true,
    });
    const absentBySession = new Map(absents.map((a) => [a.sessionId, a._count]));
    return rows.map((row) => toSessionItem(row, absentBySession.get(row.id) ?? 0));
  }

  async updateSession(
    user: AuthenticatedUser,
    sessionId: string,
    input: UpdateSessionInput,
  ): Promise<SessionItem> {
    const session = await this.requireSession(user, sessionId);
    if (
      !(await this.policy.can(user, 'attendance.record', {
        sectionId: session.sectionId,
      }))
    ) {
      throw forbidden();
    }
    const updated = await this.prisma.classSession.update({
      where: { id: sessionId },
      data: { status: input.status, note: input.note },
      include: sessionInclude,
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'attendance.session_updated',
      targetType: 'ClassSession',
      targetId: sessionId,
      metadata: { status: input.status },
    });
    return toSessionItem(updated);
  }

  // ── Attendance sheet ───────────────────────────────────────

  async getSheet(
    user: AuthenticatedUser,
    sessionId: string,
  ): Promise<AttendanceSheet> {
    const session = await this.requireSession(user, sessionId);
    if (
      !(await this.policy.can(user, 'attendance.record', {
        sectionId: session.sectionId,
      }))
    ) {
      throw forbidden();
    }

    const [enrollments, records, sectionMeta] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { sectionId: session.sectionId, status: 'ACTIVE' },
        include: {
          student: {
            include: {
              user: { select: { firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { student: { rollNo: 'asc' } },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { sessionId },
      }),
      this.prisma.section.findUniqueOrThrow({
        where: { id: session.sectionId },
        select: { name: true, course: { select: { code: true } } },
      }),
    ]);
    const recordByStudent = new Map(records.map((r) => [r.studentId, r]));

    return {
      session: toSessionItem(session),
      courseCode: sectionMeta.course.code,
      sectionName: sectionMeta.name,
      entries: enrollments.map((enrollment) => {
        const record = recordByStudent.get(enrollment.studentId);
        return {
          studentId: enrollment.studentId,
          name: `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`,
          rollNo: enrollment.student.rollNo,
          status: record?.status ?? null,
          note: record?.note ?? null,
        };
      }),
    };
  }

  /**
   * Bulk-upserts the roster's attendance for a session (Blueprint §7).
   * Marks the session HELD, records the taker, and emits
   * attendance.marked_absent per newly absent student AFTER commit.
   */
  async saveAttendance(
    user: AuthenticatedUser,
    sessionId: string,
    input: SaveAttendanceInput,
  ): Promise<AttendanceSheet> {
    const session = await this.requireSession(user, sessionId);
    if (
      !(await this.policy.can(user, 'attendance.record', {
        sectionId: session.sectionId,
      }))
    ) {
      throw forbidden();
    }
    if (session.status === 'CANCELLED') {
      throw new BadRequestException({
        code: 'SESSION_CANCELLED',
        message: 'Attendance cannot be recorded for a cancelled session',
      });
    }

    // Every record must belong to an actively enrolled student.
    const enrolled = await this.prisma.enrollment.findMany({
      where: { sectionId: session.sectionId, status: 'ACTIVE' },
      select: { studentId: true },
    });
    const enrolledIds = new Set(enrolled.map((e) => e.studentId));
    for (const record of input.records) {
      if (!enrolledIds.has(record.studentId)) {
        throw new BadRequestException({
          code: 'NOT_ENROLLED',
          message: 'One or more students are not actively enrolled in this section',
        });
      }
    }

    const previous = await this.prisma.attendanceRecord.findMany({
      where: { sessionId },
      select: { studentId: true, status: true },
    });
    const previousStatus = new Map(previous.map((r) => [r.studentId, r.status]));

    await this.prisma.$transaction([
      ...input.records.map((record) =>
        this.prisma.attendanceRecord.upsert({
          where: {
            sessionId_studentId: { sessionId, studentId: record.studentId },
          },
          update: { status: record.status, note: record.note, markedById: user.id },
          create: {
            sessionId,
            studentId: record.studentId,
            status: record.status,
            note: record.note,
            markedById: user.id,
          },
        }),
      ),
      this.prisma.classSession.update({
        where: { id: sessionId },
        data: { status: 'HELD', takenById: user.id },
      }),
    ]);

    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'attendance.recorded',
      targetType: 'ClassSession',
      targetId: sessionId,
      metadata: { records: input.records.length },
    });

    // Emit absence events post-commit — only for transitions into ABSENT.
    const newlyAbsent = input.records.filter(
      (record) =>
        record.status === 'ABSENT' &&
        previousStatus.get(record.studentId) !== 'ABSENT',
    );
    if (newlyAbsent.length > 0) {
      const [students, sectionMeta] = await Promise.all([
        this.prisma.studentProfile.findMany({
          where: { id: { in: newlyAbsent.map((r) => r.studentId) } },
          select: { id: true, userId: true },
        }),
        this.prisma.section.findUniqueOrThrow({
          where: { id: session.sectionId },
          select: { name: true, course: { select: { code: true } } },
        }),
      ]);
      const userIdByStudent = new Map(students.map((s) => [s.id, s.userId]));
      const sectionName = `${sectionMeta.course.code} — Section ${sectionMeta.name}`;
      for (const record of newlyAbsent) {
        const studentUserId = userIdByStudent.get(record.studentId);
        if (!studentUserId) continue;
        this.events.emit({
          type: 'attendance.marked_absent',
          studentUserId,
          sessionId,
          sectionName,
          date: session.date.toISOString().slice(0, 10),
        });
      }
    }

    return this.getSheet(user, sessionId);
  }

  // ── Summaries ──────────────────────────────────────────────

  async summary(
    user: AuthenticatedUser,
    query: { studentId?: string; sectionId?: string; termId?: string },
  ): Promise<AttendanceSummaryResponse> {
    const scope = await this.policy.scopeFor(user, 'attendance.read');
    if (!scope) throw forbidden();

    if (query.sectionId) {
      // Per-student breakdown for one section.
      if (scope === 'OWN') throw forbidden();
      if (scope === 'ASSIGNED') {
        const allowed = await this.policy.can(user, 'attendance.read', {
          sectionId: query.sectionId,
        });
        if (!allowed) throw forbidden();
      }
      return this.sectionSummary(user, query.sectionId);
    }

    // Per-section totals for one student.
    let studentProfileId = query.studentId;
    if (scope === 'OWN' || !studentProfileId) {
      const own = await this.prisma.studentProfile.findFirst({
        where: { userId: user.id, collegeId: user.collegeId },
        select: { id: true },
      });
      if (scope === 'OWN') {
        if (!own) throw forbidden();
        studentProfileId = own.id; // OWN scope can only ever query itself
      }
    }
    if (!studentProfileId) {
      throw new BadRequestException({
        code: 'MISSING_TARGET',
        message: 'Provide studentId or sectionId',
      });
    }
    if (scope === 'ASSIGNED') {
      const shared = await this.prisma.enrollment.findFirst({
        where: {
          studentId: studentProfileId,
          status: 'ACTIVE',
          section: {
            teachingAssignments: { some: { teacher: { userId: user.id } } },
          },
        },
        select: { id: true },
      });
      if (!shared) throw forbidden();
    }
    return this.studentSummary(user, studentProfileId, query.termId);
  }

  private async studentSummary(
    user: AuthenticatedUser,
    studentProfileId: string,
    termId?: string,
  ): Promise<AttendanceSummaryResponse> {
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        studentId: studentProfileId,
        status: 'ACTIVE',
        section: {
          collegeId: user.collegeId,
          ...(termId ? { termId } : {}),
        },
      },
      include: {
        section: {
          include: {
            course: { select: { code: true, title: true } },
            term: { select: { label: true } },
          },
        },
      },
    });

    const sections = await Promise.all(
      enrollments.map(async (enrollment) => {
        const held = await this.prisma.classSession.count({
          where: { sectionId: enrollment.sectionId, status: 'HELD' },
        });
        const counts = await this.prisma.attendanceRecord.groupBy({
          by: ['status'],
          where: {
            studentId: studentProfileId,
            session: { sectionId: enrollment.sectionId, status: 'HELD' },
          },
          _count: true,
        });
        const byStatus = Object.fromEntries(
          counts.map((entry) => [entry.status, entry._count]),
        ) as Record<string, number>;
        const present = (byStatus.PRESENT ?? 0) + (byStatus.LATE ?? 0);
        return {
          sectionId: enrollment.sectionId,
          courseCode: enrollment.section.course.code,
          courseTitle: enrollment.section.course.title,
          sectionName: enrollment.section.name,
          termLabel: enrollment.section.term.label,
          held,
          present: byStatus.PRESENT ?? 0,
          absent: byStatus.ABSENT ?? 0,
          late: byStatus.LATE ?? 0,
          excused: byStatus.EXCUSED ?? 0,
          percentage: held > 0 ? Math.round((present / held) * 1000) / 10 : null,
        };
      }),
    );
    return { kind: 'student', sections };
  }

  private async sectionSummary(
    user: AuthenticatedUser,
    sectionId: string,
  ): Promise<AttendanceSummaryResponse> {
    const section = await this.requireSection(user, sectionId);
    const held = await this.prisma.classSession.count({
      where: { sectionId, status: 'HELD' },
    });
    const enrollments = await this.prisma.enrollment.findMany({
      where: { sectionId, status: 'ACTIVE' },
      include: {
        student: {
          include: { user: { select: { firstName: true, lastName: true } } },
        },
      },
      orderBy: { student: { rollNo: 'asc' } },
    });
    const counts = await this.prisma.attendanceRecord.groupBy({
      by: ['studentId', 'status'],
      where: { session: { sectionId, status: 'HELD' } },
      _count: true,
    });
    const byStudent = new Map<string, Record<string, number>>();
    for (const entry of counts) {
      const bucket = byStudent.get(entry.studentId) ?? {};
      bucket[entry.status] = entry._count;
      byStudent.set(entry.studentId, bucket);
    }

    return {
      kind: 'section',
      summary: {
        sectionId,
        courseCode: section.course.code,
        courseTitle: section.course.title,
        sectionName: section.name,
        held,
        students: enrollments.map((enrollment) => {
          const bucket = byStudent.get(enrollment.studentId) ?? {};
          const present = (bucket.PRESENT ?? 0) + (bucket.LATE ?? 0);
          return {
            studentId: enrollment.studentId,
            name: `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`,
            rollNo: enrollment.student.rollNo,
            present: bucket.PRESENT ?? 0,
            absent: bucket.ABSENT ?? 0,
            late: bucket.LATE ?? 0,
            excused: bucket.EXCUSED ?? 0,
            percentage:
              held > 0 ? Math.round((present / held) * 1000) / 10 : null,
          };
        }),
      },
    };
  }

  // ── helpers ────────────────────────────────────────────────

  private async requireSection(user: AuthenticatedUser, sectionId: string) {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, collegeId: user.collegeId },
      include: {
        term: { select: { label: true, startsOn: true, endsOn: true } },
        course: { select: { code: true, title: true } },
      },
    });
    if (!section) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Section not found',
      });
    }
    return section;
  }

  private async requireSession(user: AuthenticatedUser, sessionId: string) {
    const session = await this.prisma.classSession.findFirst({
      where: { id: sessionId, section: { collegeId: user.collegeId } },
      include: sessionInclude,
    });
    if (!session) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Class session not found',
      });
    }
    return session;
  }
}

function mondayOf(date: Date): Date {
  const day = date.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(date, diff);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
