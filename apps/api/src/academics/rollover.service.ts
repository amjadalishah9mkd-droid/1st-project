import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  RolloverPlanInput,
  RolloverPreview,
  RolloverSectionPreview,
  RolloverStudentPreview,
} from '@campusos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TermLifecycleService } from './term-lifecycle.service';
import type { AuthenticatedUser } from '../access/authenticated-user';

/**
 * M15-W2 — term rollover engine (locked decisions D1–D8).
 *
 *   DRAFT → suggested plan → editable preview → typed confirmation →
 *   atomic execution (CAS DRAFT→EXECUTED)
 *
 * Invariants:
 *  - D1: section-mapping model (CLONE / MAP different course / SKIP);
 *    destination sections are ALWAYS new rows — source sections and all
 *    historical data stay untouched.
 *  - D2: per-student CARRY / HOLD(→repeat mapping) / EXCLUDE; zero
 *    pass/fail inference — marks/results are never read here.
 *  - D3: graduateStudents sections set profiles → GRADUATED and create
 *    no destination enrollment.
 *  - D4: teachers carried per plan via createMany(skipDuplicates).
 *  - D5/D6/D7: ZERO timetable, term-freeze or fee/invoice/payment writes
 *    anywhere in this file.
 *  - D8: WITHDRAWN/GRADUATED force-excluded (locked, re-checked at
 *    execution); SUSPENDED carried by default but flagged.
 *  - Tenancy: every lookup carries user.collegeId; plan ids are stored
 *    ids only and are REVALIDATED against live tenant data inside the
 *    execution transaction — a stale/foreign id aborts everything.
 *  - Atomicity: one interactive transaction; the TermRollover row is
 *    row-locked and CAS'd DRAFT→EXECUTED first, so concurrent executes
 *    and re-executes collapse to exactly one success.
 */

type PlanSection = RolloverPlanInput['sections'][number];

const badRequest = (code: string, message: string) =>
  new BadRequestException({ code, message });

@Injectable()
export class RolloverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lifecycle: TermLifecycleService,
  ) {}

  // ── Draft creation with suggested plan (D1/D4/D8 defaults) ──

  async createDraft(
    user: AuthenticatedUser,
    toTermId: string,
    fromTermId: string,
  ): Promise<RolloverPreview> {
    const [toTerm, fromTerm] = await Promise.all([
      this.prisma.term.findFirst({
        where: { id: toTermId, collegeId: user.collegeId },
        include: { _count: { select: { sections: true } } },
      }),
      this.prisma.term.findFirst({
        where: { id: fromTermId, collegeId: user.collegeId },
      }),
    ]);
    if (!toTerm) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Term not found' });
    }
    if (!fromTerm) {
      throw badRequest('INVALID_SOURCE_TERM', 'Source term not found in this college');
    }
    if (toTerm.id === fromTerm.id) {
      throw badRequest('SAME_TERM', 'Source and destination terms must differ');
    }
    // M17-W1: a CLOSED term cannot receive a rollover (destination must
    // be open); a CLOSED SOURCE remains valid (O-3 — reads only).
    await this.lifecycle.assertTermOpen(this.prisma, user.collegeId, toTermId);

    const existing = await this.prisma.termRollover.findUnique({
      where: {
        collegeId_toTermId: { collegeId: user.collegeId, toTermId },
      },
    });
    if (existing) {
      if (existing.status === 'EXECUTED') {
        throw new ConflictException({
          code: 'ALREADY_EXECUTED',
          message: 'A rollover into this term has already been executed',
        });
      }
      // Idempotent create: resume the existing draft.
      return this.preview(user, toTermId);
    }
    if (toTerm._count.sections > 0) {
      throw badRequest(
        'TARGET_TERM_NOT_EMPTY',
        'The destination term already has sections — rollover requires an empty term',
      );
    }

    const plan = await this.suggestPlan(user.collegeId, fromTermId);
    await this.prisma.termRollover.create({
      data: {
        collegeId: user.collegeId,
        fromTermId,
        toTermId,
        plan: plan as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'terms.rollover_drafted',
      targetType: 'Term',
      targetId: toTermId,
      metadata: { fromTermId, sections: plan.sections.length },
    });
    return this.preview(user, toTermId);
  }

  /** D1 default: same-course clone; D4: carry current teachers;
   *  D8: withdrawn/graduated excluded, suspended carried. */
  private async suggestPlan(
    collegeId: string,
    fromTermId: string,
  ): Promise<RolloverPlanInput> {
    const sections = await this.prisma.section.findMany({
      where: { collegeId, termId: fromTermId },
      include: {
        teachingAssignments: { select: { teacherId: true } },
        enrollments: {
          where: { status: 'ACTIVE' },
          include: { student: { select: { id: true, status: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });
    return {
      sections: sections.map((section) => ({
        sourceSectionId: section.id,
        action: 'CLONE' as const,
        targetName: section.name,
        graduateStudents: false,
        carryTeachers: true,
        teacherIds: section.teachingAssignments.map((a) => a.teacherId),
        students: section.enrollments.map((enrollment) => ({
          studentId: enrollment.student.id,
          decision:
            enrollment.student.status === 'WITHDRAWN' ||
            enrollment.student.status === 'GRADUATED'
              ? ('EXCLUDE' as const)
              : ('CARRY' as const),
        })),
      })),
    };
  }

  // ── Preview (draft + resolved names + summary; W3 contract) ──

  async preview(user: AuthenticatedUser, toTermId: string): Promise<RolloverPreview> {
    const rollover = await this.prisma.termRollover.findFirst({
      where: { toTermId, collegeId: user.collegeId },
      include: {
        fromTerm: { select: { label: true } },
        toTerm: { select: { label: true } },
      },
    });
    if (!rollover) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rollover not found' });
    }
    const raw = rollover.plan as unknown as Partial<RolloverPlanInput> | null;
    const plan: RolloverPlanInput = { sections: raw?.sections ?? [] };

    const sourceSections = await this.prisma.section.findMany({
      where: {
        collegeId: user.collegeId,
        id: { in: plan.sections.map((s) => s.sourceSectionId) },
      },
      include: {
        course: { select: { id: true, code: true, title: true } },
        teachingAssignments: {
          include: {
            teacher: {
              select: {
                id: true,
                user: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
        enrollments: {
          where: { status: { in: ['ACTIVE', 'COMPLETED'] } },
          include: {
            student: {
              select: {
                id: true,
                rollNo: true,
                status: true,
                user: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    });
    const bySection = new Map(sourceSections.map((s) => [s.id, s]));
    const targetCourseIds = plan.sections
      .map((s) => s.targetCourseId)
      .filter((id): id is string => !!id);
    const targetCourses = new Map(
      (
        await this.prisma.course.findMany({
          where: { collegeId: user.collegeId, id: { in: targetCourseIds } },
          select: { id: true, code: true },
        })
      ).map((c) => [c.id, c.code]),
    );

    const sections: RolloverSectionPreview[] = [];
    let enrollmentsToCreate = 0;
    let holds = 0;
    let excluded = 0;
    let graduates = 0;
    let suspendedFlags = 0;

    for (const entry of plan.sections) {
      const source = bySection.get(entry.sourceSectionId);
      if (!source) continue; // stale entry — surfaced by execution validation
      const carriedTeacherIds = new Set(entry.teacherIds ?? []);
      const students: RolloverStudentPreview[] = [];
      for (const decision of entry.students) {
        const enrollment = source.enrollments.find(
          (e) => e.student.id === decision.studentId,
        );
        if (!enrollment) continue;
        const status = enrollment.student.status;
        const locked = status === 'WITHDRAWN' || status === 'GRADUATED';
        const effective = locked ? 'EXCLUDE' : decision.decision;
        const flagged = status === 'SUSPENDED';
        if (flagged && effective !== 'EXCLUDE') suspendedFlags += 1;
        if (entry.action !== 'SKIP') {
          if (entry.graduateStudents && effective !== 'EXCLUDE') graduates += 1;
          else if (effective === 'CARRY') enrollmentsToCreate += 1;
          else if (effective === 'HOLD') {
            holds += 1;
            enrollmentsToCreate += 1;
          }
        }
        if (effective === 'EXCLUDE') excluded += 1;
        students.push({
          studentId: decision.studentId,
          name: `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`,
          rollNo: enrollment.student.rollNo,
          status,
          decision: effective,
          holdSourceSectionId: decision.holdSourceSectionId ?? null,
          flagged,
          locked,
        });
      }
      sections.push({
        sourceSectionId: entry.sourceSectionId,
        sourceName: source.name,
        courseId: source.course.id,
        courseCode: source.course.code,
        courseTitle: source.course.title,
        action: entry.action,
        targetCourseId: entry.targetCourseId ?? null,
        targetCourseCode: entry.targetCourseId
          ? (targetCourses.get(entry.targetCourseId) ?? null)
          : null,
        targetName: entry.targetName ?? source.name,
        graduateStudents: entry.graduateStudents,
        carryTeachers: entry.carryTeachers,
        teachers: source.teachingAssignments.map((assignment) => ({
          teacherId: assignment.teacher.id,
          name: `${assignment.teacher.user.firstName} ${assignment.teacher.user.lastName}`,
          carried:
            entry.carryTeachers &&
            (entry.teacherIds === undefined ||
              carriedTeacherIds.has(assignment.teacher.id)),
        })),
        students,
      });
    }

    return {
      id: rollover.id,
      status: rollover.status,
      fromTermId: rollover.fromTermId,
      fromTermLabel: rollover.fromTerm.label,
      toTermId: rollover.toTermId,
      toTermLabel: rollover.toTerm.label,
      sections,
      summary: {
        sectionsToCreate: plan.sections.filter((s) => s.action !== 'SKIP').length,
        enrollmentsToCreate,
        holds,
        excluded,
        graduates,
        suspendedFlags,
      },
      counters: (rollover.counters as Record<string, number> | null) ?? null,
      executedAt: rollover.executedAt?.toISOString() ?? null,
    };
  }

  // ── Plan update (DRAFT only) ─────────────────────────────────

  async updatePlan(
    user: AuthenticatedUser,
    toTermId: string,
    plan: RolloverPlanInput,
  ): Promise<RolloverPreview> {
    const rollover = await this.prisma.termRollover.findFirst({
      where: { toTermId, collegeId: user.collegeId },
    });
    if (!rollover) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rollover not found' });
    }
    if (rollover.status !== 'DRAFT') {
      throw new ConflictException({
        code: 'ALREADY_EXECUTED',
        message: 'This rollover has already been executed',
      });
    }
    await this.validatePlanShape(user.collegeId, rollover.fromTermId, plan);
    const updated = await this.prisma.termRollover.updateMany({
      where: { id: rollover.id, status: 'DRAFT' },
      data: { plan: plan as unknown as Prisma.InputJsonValue },
    });
    if (updated.count === 0) {
      throw new ConflictException({
        code: 'ALREADY_EXECUTED',
        message: 'This rollover has already been executed',
      });
    }
    return this.preview(user, toTermId);
  }

  /** Structural + tenancy validation shared by update and execution. */
  private async validatePlanShape(
    collegeId: string,
    fromTermId: string,
    plan: RolloverPlanInput,
  ): Promise<void> {
    const nonSkip = new Set(
      plan.sections.filter((s) => s.action !== 'SKIP').map((s) => s.sourceSectionId),
    );
    const seen = new Set<string>();
    for (const entry of plan.sections) {
      if (seen.has(entry.sourceSectionId)) {
        throw badRequest('DUPLICATE_SECTION', 'A source section appears twice in the plan');
      }
      seen.add(entry.sourceSectionId);
      if (entry.action === 'MAP' && !entry.targetCourseId) {
        throw badRequest('MISSING_TARGET_COURSE', 'MAP entries require targetCourseId');
      }
      for (const student of entry.students) {
        if (student.decision === 'HOLD') {
          if (!student.holdSourceSectionId) {
            throw badRequest(
              'MISSING_HOLD_TARGET',
              'HOLD decisions require holdSourceSectionId',
            );
          }
          if (!nonSkip.has(student.holdSourceSectionId)) {
            throw badRequest(
              'INVALID_HOLD_TARGET',
              'HOLD target must be a carried (non-SKIP) plan section',
            );
          }
        }
      }
    }
    // Tenancy: every referenced section must be a source-term section of
    // THIS college; every target course must exist in this college.
    const sectionIds = plan.sections.map((s) => s.sourceSectionId);
    const validSections = await this.prisma.section.count({
      where: { id: { in: sectionIds }, collegeId, termId: fromTermId },
    });
    if (validSections !== sectionIds.length) {
      throw badRequest(
        'INVALID_SECTION',
        'Plan references sections outside the source term',
      );
    }
    const courseIds = plan.sections
      .map((s) => s.targetCourseId)
      .filter((id): id is string => !!id);
    if (courseIds.length > 0) {
      const validCourses = await this.prisma.course.count({
        where: { id: { in: courseIds }, collegeId },
      });
      if (validCourses !== new Set(courseIds).size) {
        throw badRequest('INVALID_COURSE', 'Plan references unknown courses');
      }
    }
  }

  // ── Execution (typed confirmation → CAS → atomic) ────────────

  async execute(
    user: AuthenticatedUser,
    toTermId: string,
    confirmLabel: string,
    closeSourceTerm = false,
  ): Promise<RolloverPreview> {
    const rollover = await this.prisma.termRollover.findFirst({
      where: { toTermId, collegeId: user.collegeId },
      include: { toTerm: { select: { label: true } } },
    });
    if (!rollover) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rollover not found' });
    }
    if (confirmLabel !== rollover.toTerm.label) {
      throw badRequest(
        'CONFIRMATION_MISMATCH',
        'Type the destination term label exactly to confirm',
      );
    }

    const counters = await this.prisma.$transaction(
      async (tx) => {
        // M17-W1: destination must be open, checked INSIDE the execution
        // transaction (FOR SHARE serializes against a concurrent close).
        await this.lifecycle.assertTermOpen(tx, user.collegeId, toTermId);
        // Row lock + CAS: exactly one execution ever proceeds.
        await tx.$queryRaw`SELECT id FROM "TermRollover" WHERE id = ${rollover.id} FOR UPDATE`;
        const claimed = await tx.termRollover.updateMany({
          where: { id: rollover.id, status: 'DRAFT' },
          data: { status: 'EXECUTED', executedById: user.id, executedAt: new Date() },
        });
        if (claimed.count === 0) {
          throw new ConflictException({
            code: 'ALREADY_EXECUTED',
            message: 'This rollover has already been executed',
          });
        }

        const plan = rollover.plan as unknown as RolloverPlanInput;
        const targetSectionBySource = new Map<string, string>();
        const stats = {
          sectionsCreated: 0,
          teachingAssignments: 0,
          enrollmentsCreated: 0,
          enrollmentsCompleted: 0,
          graduated: 0,
          held: 0,
          excluded: 0,
        };

        // Pass 1: destination sections + teacher carry (per-entry live
        // revalidation inside the transaction — stale/foreign ids abort
        // the WHOLE rollover, leaving zero partial state).
        for (const entry of plan.sections) {
          if (entry.action === 'SKIP') continue;
          const source = await tx.section.findFirst({
            where: {
              id: entry.sourceSectionId,
              collegeId: user.collegeId,
              termId: rollover.fromTermId,
            },
            include: { teachingAssignments: { select: { teacherId: true } } },
          });
          if (!source) {
            throw badRequest('INVALID_SECTION', 'Plan references a missing source section');
          }
          let courseId = source.courseId;
          if (entry.action === 'MAP') {
            const course = await tx.course.findFirst({
              where: { id: entry.targetCourseId!, collegeId: user.collegeId },
              select: { id: true },
            });
            if (!course) {
              throw badRequest('INVALID_COURSE', 'Plan references a missing target course');
            }
            courseId = course.id;
          }
          const name = entry.targetName ?? source.name;
          // Retry-safe: reuse an identical destination section if a prior
          // (rolled-back or crashed-then-committed) run created it.
          let target = await tx.section.findFirst({
            where: { collegeId: user.collegeId, termId: toTermId, courseId, name },
            select: { id: true },
          });
          if (!target) {
            target = await tx.section.create({
              data: {
                collegeId: user.collegeId,
                courseId,
                termId: toTermId,
                name,
                capacity: source.capacity,
                room: source.room,
              },
              select: { id: true },
            });
            stats.sectionsCreated += 1;
          }
          targetSectionBySource.set(entry.sourceSectionId, target.id);

          if (entry.carryTeachers) {
            const teacherIds =
              entry.teacherIds ?? source.teachingAssignments.map((a) => a.teacherId);
            if (teacherIds.length > 0) {
              const valid = await tx.teacherProfile.count({
                where: { id: { in: teacherIds }, collegeId: user.collegeId },
              });
              if (valid !== new Set(teacherIds).size) {
                throw badRequest('INVALID_TEACHER', 'Plan references unknown teachers');
              }
              const created = await tx.teachingAssignment.createMany({
                data: teacherIds.map((teacherId) => ({
                  teacherId,
                  sectionId: target!.id,
                })),
                skipDuplicates: true,
              });
              stats.teachingAssignments += created.count;
            }
          }
        }

        // Pass 2: enrollments + graduation (D2/D3/D8).
        const graduateStudentIds = new Set<string>();
        for (const entry of plan.sections) {
          const targetId = targetSectionBySource.get(entry.sourceSectionId);
          const active = await tx.enrollment.findMany({
            where: {
              sectionId: entry.sourceSectionId,
              status: 'ACTIVE',
              section: { collegeId: user.collegeId },
            },
            include: { student: { select: { id: true, status: true } } },
          });
          const byStudent = new Map(active.map((e) => [e.student.id, e]));
          const rows: Array<{ studentId: string; sectionId: string }> = [];
          for (const decision of entry.students) {
            const enrollment = byStudent.get(decision.studentId);
            if (!enrollment) continue; // no longer actively enrolled here
            const status = enrollment.student.status;
            // D8 safety net: statuses re-checked LIVE at execution.
            if (status === 'WITHDRAWN' || status === 'GRADUATED') {
              stats.excluded += 1;
              continue;
            }
            if (decision.decision === 'EXCLUDE') {
              stats.excluded += 1;
              continue;
            }
            if (entry.action !== 'SKIP' && entry.graduateStudents) {
              graduateStudentIds.add(decision.studentId);
              continue;
            }
            if (decision.decision === 'HOLD') {
              const holdTarget = targetSectionBySource.get(
                decision.holdSourceSectionId ?? '',
              );
              if (!holdTarget) {
                throw badRequest(
                  'INVALID_HOLD_TARGET',
                  'HOLD target must be a carried plan section',
                );
              }
              rows.push({ studentId: decision.studentId, sectionId: holdTarget });
              stats.held += 1;
              continue;
            }
            // CARRY
            if (entry.action === 'SKIP' || !targetId) continue;
            rows.push({ studentId: decision.studentId, sectionId: targetId });
          }
          if (rows.length > 0) {
            const created = await tx.enrollment.createMany({
              data: rows,
              skipDuplicates: true, // unique(studentId, sectionId) backstop
            });
            stats.enrollmentsCreated += created.count;
          }
          // The source term is over for every listed section: conclude
          // its ACTIVE enrollments (history preserved, rows immutable).
          const completed = await tx.enrollment.updateMany({
            where: {
              sectionId: entry.sourceSectionId,
              status: 'ACTIVE',
              section: { collegeId: user.collegeId },
            },
            data: { status: 'COMPLETED' },
          });
          stats.enrollmentsCompleted += completed.count;
        }

        if (graduateStudentIds.size > 0) {
          const graduated = await tx.studentProfile.updateMany({
            where: {
              id: { in: [...graduateStudentIds] },
              collegeId: user.collegeId,
              status: 'ENROLLED',
            },
            data: { status: 'GRADUATED' },
          });
          stats.graduated = graduated.count;
        }

        await tx.termRollover.update({
          where: { id: rollover.id },
          data: { counters: stats as unknown as Prisma.InputJsonValue },
        });
        return stats;
      },
      { timeout: 30_000 },
    );

    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'terms.rollover_executed',
      targetType: 'Term',
      targetId: toTermId,
      metadata: { fromTermId: rollover.fromTermId, ...counters },
    });
    // M17-W1 (D-4): closing the source term is an EXPLICIT opt-in and
    // happens AFTER the rollover committed — a close failure (e.g. the
    // source is still the current term) never un-does the rollover.
    if (closeSourceTerm) {
      const closed = await this.lifecycle.closeFromRollover(
        user,
        rollover.fromTermId,
      );
      const preview = await this.preview(user, toTermId);
      return {
        ...preview,
        sourceTermClosed: closed.closed,
        sourceTermCloseError: closed.errorCode ?? null,
      };
    }
    return this.preview(user, toTermId);
  }
}
