import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateSlotInput,
  TimetableSlotItem,
  UpdateSlotInput,
} from '@campusos/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../access/policy.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../access/authenticated-user';

const slotInclude = {
  section: {
    include: {
      course: { select: { code: true, title: true } },
      term: { select: { id: true, label: true } },
      teachingAssignments: {
        include: {
          teacher: {
            include: { user: { select: { firstName: true, lastName: true } } },
          },
        },
      },
    },
  },
} satisfies Prisma.TimetableSlotInclude;

type SlotRecord = Prisma.TimetableSlotGetPayload<{ include: typeof slotInclude }>;

function toItem(slot: SlotRecord): TimetableSlotItem {
  return {
    id: slot.id,
    sectionId: slot.sectionId,
    dayOfWeek: slot.dayOfWeek,
    startTime: slot.startTime,
    endTime: slot.endTime,
    room: slot.room,
    courseCode: slot.section.course.code,
    courseTitle: slot.section.course.title,
    sectionName: slot.section.name,
    termLabel: slot.section.term.label,
    teacherNames: slot.section.teachingAssignments.map(
      (a) => `${a.teacher.user.firstName} ${a.teacher.user.lastName}`,
    ),
  };
}

function overlaps(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

@Injectable()
export class TimetableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Role-aware weekly timetable (Blueprint §7):
   *  view=me            → the caller's own schedule (enrolled or assigned
   *                       sections; admins with ALL scope see everything)
   *  view=section:<id>  → one section's slots (academics.read scoped)
   */
  async read(
    user: AuthenticatedUser,
    view: string,
  ): Promise<TimetableSlotItem[]> {
    const readScope = await this.policy.scopeFor(user, 'timetable.read');
    if (!readScope) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      });
    }

    let where: Prisma.TimetableSlotWhereInput;
    if (view.startsWith('section:')) {
      const sectionId = view.slice('section:'.length);
      const academicsScope = await this.policy.scopeFor(user, 'academics.read');
      where = {
        sectionId,
        section: {
          collegeId: user.collegeId,
          ...(academicsScope === 'OWN'
            ? {
                enrollments: {
                  some: { student: { userId: user.id }, status: 'ACTIVE' },
                },
              }
            : {}),
        },
      };
    } else {
      // view=me
      where = {
        section: {
          collegeId: user.collegeId,
          ...(readScope === 'ALL'
            ? {}
            : {
                OR: [
                  {
                    enrollments: {
                      some: { student: { userId: user.id }, status: 'ACTIVE' },
                    },
                  },
                  {
                    teachingAssignments: {
                      some: { teacher: { userId: user.id } },
                    },
                  },
                ],
              }),
        },
      };
    }

    const slots = await this.prisma.timetableSlot.findMany({
      where,
      include: slotInclude,
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return slots.map(toItem);
  }

  async createSlot(
    user: AuthenticatedUser,
    input: CreateSlotInput,
  ): Promise<TimetableSlotItem> {
    const section = await this.prisma.section.findFirst({
      where: { id: input.sectionId, collegeId: user.collegeId },
      select: { id: true, termId: true, room: true },
    });
    if (!section) {
      throw new BadRequestException({
        code: 'INVALID_SECTION',
        message: 'The selected section does not exist in this college',
      });
    }

    await this.assertNoConflicts(user, {
      sectionId: input.sectionId,
      termId: section.termId,
      dayOfWeek: input.dayOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
      room: input.room ?? null,
      excludeSlotId: null,
    });

    const created = await this.prisma.timetableSlot.create({
      data: {
        sectionId: input.sectionId,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
        room: input.room,
      },
      include: slotInclude,
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'timetable.slot_created',
      targetType: 'TimetableSlot',
      targetId: created.id,
    });
    return toItem(created);
  }

  async updateSlot(
    user: AuthenticatedUser,
    id: string,
    input: UpdateSlotInput,
  ): Promise<TimetableSlotItem> {
    const existing = await this.prisma.timetableSlot.findFirst({
      where: { id, section: { collegeId: user.collegeId } },
      include: { section: { select: { termId: true } } },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Timetable slot not found',
      });
    }

    const next = {
      dayOfWeek: input.dayOfWeek ?? existing.dayOfWeek,
      startTime: input.startTime ?? existing.startTime,
      endTime: input.endTime ?? existing.endTime,
      room: input.room === undefined ? existing.room : input.room,
    };
    if (next.startTime >= next.endTime) {
      throw new BadRequestException({
        code: 'INVALID_TIMES',
        message: 'End time must be after the start time',
      });
    }
    await this.assertNoConflicts(user, {
      sectionId: existing.sectionId,
      termId: existing.section.termId,
      dayOfWeek: next.dayOfWeek,
      startTime: next.startTime,
      endTime: next.endTime,
      room: next.room,
      excludeSlotId: id,
    });

    const updated = await this.prisma.timetableSlot.update({
      where: { id },
      data: next,
      include: slotInclude,
    });
    return toItem(updated);
  }

  async deleteSlot(
    user: AuthenticatedUser,
    id: string,
  ): Promise<{ removed: true }> {
    const existing = await this.prisma.timetableSlot.findFirst({
      where: { id, section: { collegeId: user.collegeId } },
      include: { _count: { select: { sessions: true } } },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Timetable slot not found',
      });
    }
    if (existing._count.sessions > 0) {
      // Restrict policy: sessions (and their attendance) reference the slot.
      throw new BadRequestException({
        code: 'SLOT_HAS_SESSIONS',
        message:
          'This slot already has class sessions and cannot be deleted. Adjust its times instead.',
      });
    }
    await this.prisma.timetableSlot.delete({ where: { id } });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'timetable.slot_deleted',
      targetType: 'TimetableSlot',
      targetId: id,
    });
    return { removed: true };
  }

  /**
   * Conflict detection (Blueprint M3):
   *  - SLOT_CONFLICT: the same section already meets at an overlapping time.
   *  - ROOM_CONFLICT: another section in the same term occupies the room at
   *    an overlapping time.
   */
  private async assertNoConflicts(
    user: AuthenticatedUser,
    check: {
      sectionId: string;
      termId: string;
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      room: string | null;
      excludeSlotId: string | null;
    },
  ): Promise<void> {
    const sameDaySlots = await this.prisma.timetableSlot.findMany({
      where: {
        dayOfWeek: check.dayOfWeek,
        section: { collegeId: user.collegeId, termId: check.termId },
        ...(check.excludeSlotId ? { id: { not: check.excludeSlotId } } : {}),
      },
      include: {
        section: {
          select: { id: true, name: true, course: { select: { code: true } } },
        },
      },
    });

    for (const slot of sameDaySlots) {
      if (!overlaps(check.startTime, check.endTime, slot.startTime, slot.endTime)) {
        continue;
      }
      if (slot.sectionId === check.sectionId) {
        throw new BadRequestException({
          code: 'SLOT_CONFLICT',
          message: `This section already meets ${slot.startTime}–${slot.endTime} on that day`,
        });
      }
      if (check.room && slot.room && slot.room === check.room) {
        throw new BadRequestException({
          code: 'ROOM_CONFLICT',
          message: `Room ${check.room} is occupied by ${slot.section.course.code} — Section ${slot.section.name} (${slot.startTime}–${slot.endTime})`,
        });
      }
    }
  }
}
