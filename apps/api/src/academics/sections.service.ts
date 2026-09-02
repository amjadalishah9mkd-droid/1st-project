import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AssignTeacherInput,
  CreateSectionInput,
  PageMeta,
  PaginationQuery,
  SectionItem,
  SectionOverview,
  UpdateSectionInput,
} from '@campusos/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../access/policy.service';
import { AuditService } from '../audit/audit.service';
import { changedFields } from '../audit/changed-fields';
import { StudentsService } from '../users/students.service';
import { TeachersService } from '../users/teachers.service';
import type { AuthenticatedUser } from '../access/authenticated-user';
import { TermLifecycleService } from './term-lifecycle.service';
import { pageArgs, pageMeta } from '../common/pagination/pagination';

const sectionInclude = {
  course: {
    select: {
      id: true,
      code: true,
      title: true,
      department: { select: { name: true } },
    },
  },
  term: { select: { id: true, label: true } },
  teachingAssignments: {
    include: {
      teacher: {
        include: { user: { select: { firstName: true, lastName: true } } },
      },
    },
  },
  _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
} satisfies Prisma.SectionInclude;

type SectionRecord = Prisma.SectionGetPayload<{ include: typeof sectionInclude }>;

function toItem(row: SectionRecord): SectionItem {
  return {
    id: row.id,
    name: row.name,
    capacity: row.capacity,
    room: row.room,
    courseId: row.course.id,
    courseCode: row.course.code,
    courseTitle: row.course.title,
    departmentName: row.course.department.name,
    termId: row.term.id,
    termLabel: row.term.label,
    enrolledCount: row._count.enrollments,
    teacherNames: row.teachingAssignments.map(
      (a) => `${a.teacher.user.firstName} ${a.teacher.user.lastName}`,
    ),
  };
}

@Injectable()
export class SectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: TermLifecycleService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly students: StudentsService,
    private readonly teachers: TeachersService,
  ) {}

  /**
   * Scoped list per academics.read: ALL → all sections; OWN (students) →
   * sections they're actively enrolled in. `mine=true` additionally narrows
   * teachers to their assigned sections (self-filter, not authorization).
   */
  async list(
    user: AuthenticatedUser,
    query: PaginationQuery & { courseId?: string; termId?: string; mine?: string },
  ): Promise<{ data: SectionItem[]; meta: PageMeta }> {
    const scope = await this.policy.scopeFor(user, 'academics.read');
    const where: Prisma.SectionWhereInput = {
      collegeId: user.collegeId,
      ...(query.courseId ? { courseId: query.courseId } : {}),
      ...(query.termId ? { termId: query.termId } : {}),
      ...(scope === 'OWN'
        ? {
            enrollments: {
              some: { student: { userId: user.id }, status: 'ACTIVE' },
            },
          }
        : {}),
      ...(query.mine === 'true' && scope !== 'OWN'
        ? { teachingAssignments: { some: { teacher: { userId: user.id } } } }
        : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { course: { code: { contains: query.q, mode: 'insensitive' } } },
              { course: { title: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.section.findMany({
        where,
        include: sectionInclude,
        orderBy: [{ course: { code: 'asc' } }, { name: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.section.count({ where }),
    ]);
    return { data: rows.map(toItem), meta: pageMeta(query, total) };
  }

  async detail(user: AuthenticatedUser, id: string): Promise<SectionItem> {
    const row = await this.findScoped(user, id);
    return toItem(row);
  }

  async create(
    user: AuthenticatedUser,
    input: CreateSectionInput,
  ): Promise<SectionItem> {
    const course = await this.prisma.course.findFirst({
      where: { id: input.courseId, collegeId: user.collegeId },
      select: { id: true, status: true },
    });
    if (!course) {
      throw new BadRequestException({
        code: 'INVALID_COURSE',
        message: 'The selected course does not exist in this college',
      });
    }
    if (course.status === 'ARCHIVED') {
      throw new BadRequestException({
        code: 'COURSE_ARCHIVED',
        message: 'Archived courses cannot receive new sections',
      });
    }
    const term = await this.prisma.term.findFirst({
      where: { id: input.termId, collegeId: user.collegeId },
      select: { id: true },
    });
    if (!term) {
      throw new BadRequestException({
        code: 'INVALID_TERM',
        message: 'The selected term does not exist in this college',
      });
    }
    // M17-W2: sections cannot be created in a CLOSED term.
    await this.lifecycle.assertTermOpen(this.prisma, user.collegeId, input.termId);
    const duplicate = await this.prisma.section.findFirst({
      where: {
        courseId: input.courseId,
        termId: input.termId,
        name: input.name,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException({
        code: 'DUPLICATE_SECTION_NAME',
        message: `Section "${input.name}" already exists for this course and term`,
      });
    }

    const created = await this.prisma.section.create({
      data: {
        collegeId: user.collegeId,
        courseId: input.courseId,
        termId: input.termId,
        name: input.name,
        capacity: input.capacity,
        room: input.room,
      },
      include: sectionInclude,
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'sections.created',
      targetType: 'Section',
      targetId: created.id,
    });
    return toItem(created);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateSectionInput,
  ): Promise<SectionItem> {
    const existing = await this.prisma.section.findFirst({
      where: { id, collegeId: user.collegeId },
      include: { _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Section not found',
      });
    }
    // M17-W2: CLOSED terms are read-only for section structure.
    await this.lifecycle.assertTermOpen(this.prisma, user.collegeId, existing.termId);
    if (
      input.capacity !== undefined &&
      input.capacity < existing._count.enrollments
    ) {
      throw new BadRequestException({
        code: 'CAPACITY_BELOW_ENROLLMENT',
        message: `Capacity cannot be below the current enrollment (${existing._count.enrollments})`,
      });
    }
    if (input.name) {
      const duplicate = await this.prisma.section.findFirst({
        where: {
          courseId: existing.courseId,
          termId: existing.termId,
          name: input.name,
          id: { not: id },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new BadRequestException({
          code: 'DUPLICATE_SECTION_NAME',
          message: `Section "${input.name}" already exists for this course and term`,
        });
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.section.update({
        where: { id },
        data: { name: input.name, capacity: input.capacity, room: input.room },
        include: sectionInclude,
      });
      // M23-W2 (S-2): sections.created was audited, updates were not.
      // Capacity and name changes affect enrollment eligibility.
      await this.audit.logAtomic(
        {
          collegeId: user.collegeId,
          actorId: user.id,
          action: 'sections.updated',
          targetType: 'Section',
          targetId: id,
          metadata: {
            termId: existing.termId,
            courseId: existing.courseId,
            changed: changedFields(['name', 'capacity', 'room'], existing, {
              name: input.name,
              capacity: input.capacity,
              room: input.room,
            }),
          },
        },
        tx,
      );
      return row;
    });
    return toItem(updated);
  }

  // ── Section hub ────────────────────────────────────────────

  async overview(user: AuthenticatedUser, id: string): Promise<SectionOverview> {
    await this.findScoped(user, id); // access check + existence
    const row = await this.prisma.section.findUniqueOrThrow({
      where: { id },
      include: {
        course: {
          include: { department: { select: { id: true, name: true, code: true } } },
        },
        term: { select: { id: true, label: true, isCurrent: true } },
        teachingAssignments: {
          include: {
            teacher: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true } },
              },
            },
          },
          orderBy: { isPrimary: 'desc' },
        },
        enrollments: {
          where: { status: 'ACTIVE' },
          include: {
            student: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true } },
              },
            },
          },
          orderBy: { student: { rollNo: 'asc' } },
        },
        timetableSlots: { orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] },
      },
    });

    return {
      id: row.id,
      name: row.name,
      capacity: row.capacity,
      room: row.room,
      course: {
        id: row.course.id,
        code: row.course.code,
        title: row.course.title,
        credits: row.course.credits,
        status: row.course.status,
      },
      department: row.course.department,
      term: row.term,
      enrolledCount: row.enrollments.length,
      teachers: row.teachingAssignments.map((assignment) => ({
        assignmentId: assignment.id,
        teacherId: assignment.teacherId,
        userId: assignment.teacher.user.id,
        name: `${assignment.teacher.user.firstName} ${assignment.teacher.user.lastName}`,
        designation: assignment.teacher.designation,
        isPrimary: assignment.isPrimary,
      })),
      students: row.enrollments.map((enrollment) => ({
        enrollmentId: enrollment.id,
        studentId: enrollment.studentId,
        userId: enrollment.student.user.id,
        name: `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`,
        rollNo: enrollment.student.rollNo,
        admissionNo: enrollment.student.admissionNo,
        status: enrollment.status,
      })),
      // Real rows only — M3 populates these; empty until then.
      timetableSlots: row.timetableSlots.map((slot) => ({
        id: slot.id,
        dayOfWeek: slot.dayOfWeek,
        startTime: slot.startTime,
        endTime: slot.endTime,
        room: slot.room,
      })),
    };
  }

  // ── Enrollment ─────────────────────────────────────────────

  async enroll(
    user: AuthenticatedUser,
    sectionId: string,
    studentProfileId: string,
  ): Promise<{ enrolled: true }> {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, collegeId: user.collegeId },
      include: {
        _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
      },
    });
    if (!section) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Section not found',
      });
    }
    // M17-W2: CLOSED terms are read-only for section membership/structure.
    await this.lifecycle.assertSectionTermOpen(this.prisma, user.collegeId, sectionId);
    // Cross-module read through the owning service (tenant-checked).
    const student = await this.students.profileInCollege(
      user.collegeId,
      studentProfileId,
    );
    if (!student) {
      throw new BadRequestException({
        code: 'INVALID_STUDENT',
        message: 'The selected student does not exist in this college',
      });
    }
    const existing = await this.prisma.enrollment.findUnique({
      where: {
        studentId_sectionId: { studentId: studentProfileId, sectionId },
      },
    });
    if (existing && existing.status === 'ACTIVE') {
      throw new ConflictException({
        code: 'ALREADY_ENROLLED',
        message: `${student.name} is already enrolled in this section`,
      });
    }
    if (section._count.enrollments >= section.capacity) {
      throw new ConflictException({
        code: 'SECTION_FULL',
        message: `Section is at capacity (${section.capacity})`,
      });
    }

    if (existing) {
      await this.prisma.enrollment.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE', enrolledAt: new Date() },
      });
    } else {
      await this.prisma.enrollment.create({
        data: { studentId: studentProfileId, sectionId },
      });
    }
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'enrollments.created',
      targetType: 'Section',
      targetId: sectionId,
      metadata: { studentProfileId },
    });
    return { enrolled: true };
  }

  async unenroll(
    user: AuthenticatedUser,
    sectionId: string,
    studentProfileId: string,
  ): Promise<{ removed: true }> {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, collegeId: user.collegeId },
      select: { id: true },
    });
    if (!section) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Section not found',
      });
    }
    // M17-W2: CLOSED terms are read-only for section membership/structure.
    await this.lifecycle.assertSectionTermOpen(this.prisma, user.collegeId, sectionId);
    const enrollment = await this.prisma.enrollment.findUnique({
      where: {
        studentId_sectionId: { studentId: studentProfileId, sectionId },
      },
    });
    if (!enrollment || enrollment.status !== 'ACTIVE') {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Enrollment not found',
      });
    }
    await this.prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { status: 'DROPPED' },
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'enrollments.dropped',
      targetType: 'Section',
      targetId: sectionId,
      metadata: { studentProfileId },
    });
    return { removed: true };
  }

  // ── Teaching assignments ───────────────────────────────────

  async assignTeacher(
    user: AuthenticatedUser,
    sectionId: string,
    teacherProfileId: string,
    input: AssignTeacherInput,
  ): Promise<{ assigned: true }> {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, collegeId: user.collegeId },
      select: { id: true },
    });
    if (!section) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Section not found',
      });
    }
    // M17-W2: CLOSED terms are read-only for section membership/structure.
    await this.lifecycle.assertSectionTermOpen(this.prisma, user.collegeId, sectionId);
    const teacher = await this.teachers.profileInCollege(
      user.collegeId,
      teacherProfileId,
    );
    if (!teacher) {
      throw new BadRequestException({
        code: 'INVALID_TEACHER',
        message: 'The selected teacher does not exist in this college',
      });
    }
    const existing = await this.prisma.teachingAssignment.findUnique({
      where: {
        teacherId_sectionId: { teacherId: teacherProfileId, sectionId },
      },
    });
    if (existing) {
      throw new ConflictException({
        code: 'ALREADY_ASSIGNED',
        message: `${teacher.name} is already assigned to this section`,
      });
    }

    await this.prisma.$transaction([
      ...(input.isPrimary
        ? [
            this.prisma.teachingAssignment.updateMany({
              where: { sectionId, isPrimary: true },
              data: { isPrimary: false },
            }),
          ]
        : []),
      this.prisma.teachingAssignment.create({
        data: {
          teacherId: teacherProfileId,
          sectionId,
          isPrimary: input.isPrimary ?? false,
        },
      }),
    ]);
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'teaching_assignments.created',
      targetType: 'Section',
      targetId: sectionId,
      metadata: { teacherProfileId, isPrimary: input.isPrimary ?? false },
    });
    return { assigned: true };
  }

  async unassignTeacher(
    user: AuthenticatedUser,
    sectionId: string,
    teacherProfileId: string,
  ): Promise<{ removed: true }> {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, collegeId: user.collegeId },
      select: { id: true },
    });
    if (!section) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Section not found',
      });
    }
    // M17-W2: CLOSED terms are read-only for section membership/structure.
    await this.lifecycle.assertSectionTermOpen(this.prisma, user.collegeId, sectionId);
    const existing = await this.prisma.teachingAssignment.findUnique({
      where: {
        teacherId_sectionId: { teacherId: teacherProfileId, sectionId },
      },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Teaching assignment not found',
      });
    }
    await this.prisma.teachingAssignment.delete({ where: { id: existing.id } });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'teaching_assignments.removed',
      targetType: 'Section',
      targetId: sectionId,
      metadata: { teacherProfileId },
    });
    return { removed: true };
  }

  /** College + OWN-scope aware section fetch used by detail/overview. */
  private async findScoped(
    user: AuthenticatedUser,
    id: string,
  ): Promise<SectionRecord> {
    const scope = await this.policy.scopeFor(user, 'academics.read');
    const row = await this.prisma.section.findFirst({
      where: {
        id,
        collegeId: user.collegeId,
        ...(scope === 'OWN'
          ? {
              enrollments: {
                some: { student: { userId: user.id }, status: 'ACTIVE' },
              },
            }
          : {}),
      },
      include: sectionInclude,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Section not found',
      });
    }
    return row;
  }
}
