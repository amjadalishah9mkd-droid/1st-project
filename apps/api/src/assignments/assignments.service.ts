import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AssignmentDetail,
  AssignmentItem,
  CreateAssignmentInput,
  GradeSubmissionInput,
  PageMeta,
  PaginationQuery,
  SubmissionList,
  SubmitAssignmentInput,
  UpdateAssignmentInput,
} from '@campusos/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../access/policy.service';
import { AuditService } from '../audit/audit.service';
import { changedFields } from '../audit/changed-fields';
import { EventsService } from '../events/events.module';
import type { AuthenticatedUser } from '../access/authenticated-user';
import { TermLifecycleService } from '../academics/term-lifecycle.service';
import { pageArgs, pageMeta } from '../common/pagination/pagination';

const assignmentInclude = {
  section: {
    include: {
      course: { select: { code: true, title: true } },
      term: { select: { label: true } },
      _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
    },
  },
  createdBy: { select: { firstName: true, lastName: true } },
  _count: { select: { submissions: true } },
} satisfies Prisma.AssignmentInclude;

type AssignmentRecord = Prisma.AssignmentGetPayload<{
  include: typeof assignmentInclude;
}>;

function forbidden(): ForbiddenException {
  return new ForbiddenException({
    code: 'FORBIDDEN',
    message: 'You do not have permission to perform this action',
  });
}

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: TermLifecycleService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  private async toItem(
    row: AssignmentRecord,
    user: AuthenticatedUser,
    gradedCountMap?: Map<string, number>,
  ): Promise<AssignmentItem> {
    let mySubmission: AssignmentItem['mySubmission'] = null;
    const own = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (own) {
      const submission = await this.prisma.submission.findUnique({
        where: {
          assignmentId_studentId: {
            assignmentId: row.id,
            studentId: own.id,
          },
        },
      });
      if (submission) {
        mySubmission = {
          id: submission.id,
          submittedAt: submission.submittedAt.toISOString(),
          isLate: submission.isLate,
          points: submission.points?.toString() ?? null,
          feedback: submission.feedback,
          gradedAt: submission.gradedAt?.toISOString() ?? null,
        };
      }
    }
    const gradedCount =
      gradedCountMap?.get(row.id) ??
      (await this.prisma.submission.count({
        where: { assignmentId: row.id, points: { not: null } },
      }));

    return {
      id: row.id,
      sectionId: row.sectionId,
      courseCode: row.section.course.code,
      courseTitle: row.section.course.title,
      sectionName: row.section.name,
      termLabel: row.section.term.label,
      title: row.title,
      dueAt: row.dueAt.toISOString(),
      maxPoints: row.maxPoints.toString(),
      allowLate: row.allowLate,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      createdByName: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
      submissionCount: row._count.submissions,
      gradedCount,
      enrolledCount: row.section._count.enrollments,
      mySubmission,
    };
  }

  /**
   * Scoped list: ALL → college-wide; ASSIGNED → caller's sections (drafts
   * visible); OWN → enrolled sections, PUBLISHED only.
   */
  async list(
    user: AuthenticatedUser,
    query: PaginationQuery & { sectionId?: string; studentId?: string },
  ): Promise<{ data: AssignmentItem[]; meta: PageMeta }> {
    const scope = await this.policy.scopeFor(user, 'assignments.read');
    if (!scope) throw forbidden();

    // M13-W3: CHILD scope — read-only view of a linked child's published
    // assignments; the link is verified by PolicyService per request.
    if (scope === 'CHILD') {
      if (!query.studentId) {
        throw new BadRequestException({
          code: 'MISSING_TARGET',
          message: 'Provide studentId',
        });
      }
      const allowed = await this.policy.can(user, 'assignments.read', {
        studentProfileId: query.studentId,
      });
      if (!allowed) throw forbidden();
    }

    const where: Prisma.AssignmentWhereInput = {
      section: { collegeId: user.collegeId },
      ...(query.sectionId ? { sectionId: query.sectionId } : {}),
      ...(query.q
        ? { title: { contains: query.q, mode: 'insensitive' } }
        : {}),
      ...(scope === 'ASSIGNED'
        ? {
            section: {
              collegeId: user.collegeId,
              teachingAssignments: { some: { teacher: { userId: user.id } } },
            },
          }
        : {}),
      ...(scope === 'OWN'
        ? {
            publishedAt: { not: null },
            section: {
              collegeId: user.collegeId,
              enrollments: {
                some: { student: { userId: user.id }, status: 'ACTIVE' },
              },
            },
          }
        : {}),
      ...(scope === 'CHILD'
        ? {
            publishedAt: { not: null }, // published only, like OWN
            section: {
              collegeId: user.collegeId,
              enrollments: {
                some: { studentId: query.studentId, status: 'ACTIVE' },
              },
            },
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.assignment.findMany({
        where,
        include: assignmentInclude,
        orderBy: { dueAt: 'asc' },
        ...pageArgs(query),
      }),
      this.prisma.assignment.count({ where }),
    ]);

    const gradedCounts = await this.prisma.submission.groupBy({
      by: ['assignmentId'],
      where: { assignmentId: { in: rows.map((r) => r.id) }, points: { not: null } },
      _count: true,
    });
    const gradedMap = new Map(gradedCounts.map((g) => [g.assignmentId, g._count]));

    const data: AssignmentItem[] = [];
    for (const row of rows) {
      data.push(await this.toItem(row, user, gradedMap));
    }
    return { data, meta: pageMeta(query, total) };
  }

  async detail(user: AuthenticatedUser, id: string): Promise<AssignmentDetail> {
    const row = await this.findScoped(user, id);
    const item = await this.toItem(row, user);

    let mySubmissionContent: AssignmentDetail['mySubmissionContent'] = null;
    if (item.mySubmission) {
      const submission = await this.prisma.submission.findUnique({
        where: { id: item.mySubmission.id },
        select: { textContent: true, fileUrl: true, fileName: true },
      });
      mySubmissionContent = submission ?? null;
    }
    return {
      ...item,
      description: row.description,
      attachments:
        (row.attachments as unknown as AssignmentDetail['attachments']) ?? [],
      mySubmissionContent,
    };
  }

  async create(
    user: AuthenticatedUser,
    input: CreateAssignmentInput,
  ): Promise<AssignmentItem> {
    const section = await this.prisma.section.findFirst({
      where: { id: input.sectionId, collegeId: user.collegeId },
      select: { id: true },
    });
    if (!section) {
      throw new BadRequestException({
        code: 'INVALID_SECTION',
        message: 'The selected section does not exist in this college',
      });
    }
    // Object-level check: ASSIGNED teachers only in their sections.
    if (
      !(await this.policy.can(user, 'assignments.manage', {
        sectionId: input.sectionId,
      }))
    ) {
      throw forbidden();
    }
    // M17-W2: CLOSED terms are read-only for assignments.
    // M24-W3a (N-3): the guard MOVED into the creating transaction. Nothing
    // was validated between the old guard and this insert, so relocating it
    // changes no error precedence — the simple form is correct here and no
    // preflight is needed. On `tx` the Section's Term is held `FOR SHARE`
    // through the insert, so an assignment can no longer be created after a
    // concurrent close committed.
    const created = await this.prisma.$transaction(async (tx) => {
      await this.lifecycle.assertSectionTermOpen(
        tx,
        user.collegeId,
        input.sectionId,
      );
      return tx.assignment.create({
        data: {
          sectionId: input.sectionId,
          title: input.title,
          description: input.description,
          attachments: input.attachments,
          dueAt: new Date(input.dueAt),
          maxPoints: input.maxPoints,
          allowLate: input.allowLate,
          createdById: user.id,
        },
        include: assignmentInclude,
      });
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'assignments.created',
      targetType: 'Assignment',
      targetId: created.id,
    });
    return this.toItem(created, user);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateAssignmentInput,
  ): Promise<AssignmentItem> {
    const existing = await this.requireManaged(user, id);
    await this.lifecycle.assertSectionTermOpen(
      this.prisma,
      user.collegeId,
      existing.sectionId,
    );
    if (input.maxPoints !== undefined) {
      const over = await this.prisma.submission.findFirst({
        where: { assignmentId: id, points: { gt: input.maxPoints } },
        select: { id: true },
      });
      if (over) {
        throw new BadRequestException({
          code: 'MAX_POINTS_BELOW_GRADES',
          message: 'Max points cannot be lower than an already-awarded grade',
        });
      }
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      // M24-W3a (N-3): AUTHORITATIVE lifecycle guard. The assertion above
      // is a PREFLIGHT on `this.prisma`, so its `FOR SHARE` lock on the
      // Term row is released as soon as that statement's implicit
      // transaction commits — leaving a window in which a concurrent close
      // could commit before the writes below. Re-asserting on `tx` holds
      // the lock (against close's `FOR UPDATE`) for the whole transaction,
      // so the assignment update and the dependent `isLate` recomputation
      // can no longer land in a closed term. The preflight is retained
      // deliberately: it is what makes TERM_CLOSED precede
      // MAX_POINTS_BELOW_GRADES, and the grade probe stays outside so the
      // lock window covers writes only. Same dual pattern as
      // `fees.generateInvoices` and Batches 1-3.
      await this.lifecycle.assertSectionTermOpen(
        tx,
        user.collegeId,
        existing.sectionId,
      );
      const row = await tx.assignment.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          description: input.description,
          attachments: input.attachments,
          dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
          maxPoints: input.maxPoints,
          allowLate: input.allowLate,
        },
        include: assignmentInclude,
      });
      // M24-W3b (N-14): `Submission.isLate` is a PERSISTED fact computed
      // once at submit time (`now > assignment.dueAt`). Moving `dueAt`
      // therefore left existing submissions mis-flagged forever —
      // on-time work looked late after the date was pulled in, and late
      // work looked on-time after an extension. The due date stays
      // mutable (that is the existing documented contract); what is
      // corrected here is the DERIVED flag, recomputed against the new
      // due date inside the same transaction so an assignment and its
      // submissions can never disagree. The comparison is the same one
      // `submit` uses — strictly greater than, so a submission exactly at
      // the due date is on time — and existing timestamp handling is
      // reused unchanged.
      if (row.dueAt.getTime() !== existing.dueAt.getTime()) {
        await tx.submission.updateMany({
          where: { assignmentId: existing.id, submittedAt: { gt: row.dueAt } },
          data: { isLate: true },
        });
        await tx.submission.updateMany({
          where: { assignmentId: existing.id, submittedAt: { lte: row.dueAt } },
          data: { isLate: false },
        });
      }
      // M23-W2 (S-2): assignments.created/published/deleted were
      // audited, updates were not — yet due dates and maxPoints change
      // how existing submissions are graded. Field NAMES only: the
      // description is free-text student-facing content and never
      // belongs in the audit trail.
      await this.audit.logAtomic(
        {
          collegeId: user.collegeId,
          actorId: user.id,
          action: 'assignments.updated',
          targetType: 'Assignment',
          targetId: existing.id,
          metadata: {
            sectionId: existing.sectionId,
            changed: changedFields(
              ['title', 'description', 'dueAt', 'maxPoints', 'allowLate'],
              existing,
              {
                title: input.title,
                description: input.description,
                dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
                maxPoints: input.maxPoints,
                allowLate: input.allowLate,
              },
            ),
          },
        },
        tx,
      );
      return row;
    });
    return this.toItem(updated, user);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<{ removed: true }> {
    const existing = await this.requireManaged(user, id);
    await this.lifecycle.assertSectionTermOpen(
      this.prisma,
      user.collegeId,
      existing.sectionId,
    );
    const submissions = await this.prisma.submission.count({
      where: { assignmentId: id },
    });
    if (submissions > 0) {
      throw new BadRequestException({
        code: 'HAS_SUBMISSIONS',
        message:
          'Assignments with submissions cannot be deleted — student work is preserved',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      // M24-W3a (N-3): AUTHORITATIVE guard, inside the deleting
      // transaction. Retained preflight keeps TERM_CLOSED ahead of
      // HAS_SUBMISSIONS; the submission count stays outside, so the
      // student-work protection is evaluated exactly as before.
      await this.lifecycle.assertSectionTermOpen(
        tx,
        user.collegeId,
        existing.sectionId,
      );
      await tx.assignment.delete({ where: { id: existing.id } });
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'assignments.deleted',
      targetType: 'Assignment',
      targetId: id,
    });
    return { removed: true };
  }

  async publish(user: AuthenticatedUser, id: string): Promise<AssignmentItem> {
    const existing = await this.requireManaged(user, id);
    await this.lifecycle.assertSectionTermOpen(
      this.prisma,
      user.collegeId,
      existing.sectionId,
    );
    if (existing.publishedAt) {
      throw new BadRequestException({
        code: 'ALREADY_PUBLISHED',
        message: 'This assignment is already published',
      });
    }
    // M24-W3a (N-3): AUTHORITATIVE guard shares the publishing
    // transaction. Retained preflight keeps TERM_CLOSED ahead of
    // ALREADY_PUBLISHED. The audit write and the notification event stay
    // AFTER the commit exactly as before — the event must never fire for a
    // publish that later rolled back, so it is deliberately not moved
    // inside, and its payload is taken from the committed row.
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lifecycle.assertSectionTermOpen(
        tx,
        user.collegeId,
        existing.sectionId,
      );
      return tx.assignment.update({
        where: { id: existing.id },
        data: { publishedAt: new Date() },
        include: assignmentInclude,
      });
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'assignments.published',
      targetType: 'Assignment',
      targetId: id,
    });
    this.events.emit({
      type: 'assignment.published',
      sectionId: updated.sectionId,
      assignmentId: updated.id,
      title: updated.title,
      dueAt: updated.dueAt.toISOString(),
    });
    return this.toItem(updated, user);
  }

  // ── Submissions ────────────────────────────────────────────

  async submissions(
    user: AuthenticatedUser,
    assignmentId: string,
  ): Promise<SubmissionList> {
    const assignment = await this.requireGradable(user, assignmentId);

    const [enrollments, submissions] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { sectionId: assignment.sectionId, status: 'ACTIVE' },
        include: {
          student: {
            include: { user: { select: { firstName: true, lastName: true } } },
          },
        },
        orderBy: { student: { rollNo: 'asc' } },
      }),
      this.prisma.submission.findMany({
        where: { assignmentId },
        include: { gradedBy: { select: { firstName: true, lastName: true } } },
      }),
    ]);
    const byStudent = new Map(submissions.map((s) => [s.studentId, s]));

    return {
      assignmentId,
      title: assignment.title,
      maxPoints: assignment.maxPoints.toString(),
      dueAt: assignment.dueAt.toISOString(),
      entries: enrollments.map((enrollment) => {
        const submission = byStudent.get(enrollment.studentId);
        return {
          studentId: enrollment.studentId,
          studentName: `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`,
          rollNo: enrollment.student.rollNo,
          submission: submission
            ? {
                id: submission.id,
                submittedAt: submission.submittedAt.toISOString(),
                isLate: submission.isLate,
                textContent: submission.textContent,
                fileUrl: submission.fileUrl,
                fileName: submission.fileName,
                points: submission.points?.toString() ?? null,
                feedback: submission.feedback,
                gradedAt: submission.gradedAt?.toISOString() ?? null,
                gradedByName: submission.gradedBy
                  ? `${submission.gradedBy.firstName} ${submission.gradedBy.lastName}`
                  : null,
              }
            : null,
        };
      }),
    };
  }

  /**
   * Student submission (Blueprint W4):
   *  - assignment must be published and in an enrolled section
   *  - after dueAt: rejected unless allowLate, in which case isLate=true
   *  - one submission per student (unique constraint); resubmission allowed
   *    until graded
   */
  async submit(
    user: AuthenticatedUser,
    assignmentId: string,
    input: SubmitAssignmentInput,
  ): Promise<AssignmentDetail> {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, section: { collegeId: user.collegeId } },
      select: {
        id: true,
        sectionId: true,
        publishedAt: true,
        dueAt: true,
        allowLate: true,
      },
    });
    if (!assignment || !assignment.publishedAt) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Assignment not found',
      });
    }
    await this.lifecycle.assertSectionTermOpen(
      this.prisma,
      user.collegeId,
      assignment.sectionId,
    );
    const student = await this.prisma.studentProfile.findFirst({
      where: { userId: user.id, collegeId: user.collegeId },
      select: { id: true },
    });
    if (
      !student ||
      !(await this.policy.can(user, 'assignments.submit', {
        ownerUserId: user.id,
      }))
    ) {
      throw forbidden();
    }
    const enrolled = await this.prisma.enrollment.findFirst({
      where: {
        studentId: student.id,
        sectionId: assignment.sectionId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (!enrolled) {
      throw forbidden();
    }

    const now = new Date();
    const isLate = now > assignment.dueAt;
    if (isLate && !assignment.allowLate) {
      throw new BadRequestException({
        code: 'PAST_DUE',
        message: 'The due date has passed and late submissions are not allowed',
      });
    }

    const existing = await this.prisma.submission.findUnique({
      where: {
        assignmentId_studentId: { assignmentId, studentId: student.id },
      },
      select: { id: true, gradedAt: true },
    });
    if (existing?.gradedAt) {
      throw new BadRequestException({
        code: 'ALREADY_GRADED',
        message: 'This submission has been graded and can no longer be changed',
      });
    }

    const wasResubmission = await this.prisma.$transaction(async (tx) => {
      // M24-W3a (N-3 #13): the checks above preserve established error
      // precedence but are preflights only. This guard holds the owning Term
      // FOR SHARE through every authoritative decision and the upsert.
      await this.lifecycle.assertSectionTermOpen(
        tx,
        user.collegeId,
        assignment.sectionId,
      );

      // Stabilize the assignment fields that govern publication/deadline
      // eligibility while the submission is decided and written.
      await tx.$queryRaw`SELECT id FROM "Assignment" WHERE id = ${assignmentId} FOR SHARE`;
      const authoritativeAssignment = await tx.assignment.findFirst({
        where: {
          id: assignmentId,
          sectionId: assignment.sectionId,
          section: { collegeId: user.collegeId },
        },
        select: {
          id: true,
          sectionId: true,
          publishedAt: true,
          dueAt: true,
          allowLate: true,
        },
      });
      if (!authoritativeAssignment?.publishedAt) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Assignment not found',
        });
      }

      const activeEnrollments = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Enrollment"
        WHERE "studentId" = ${student.id}
          AND "sectionId" = ${authoritativeAssignment.sectionId}
          AND status = 'ACTIVE'
        FOR SHARE`;
      if (activeEnrollments.length === 0) {
        throw forbidden();
      }

      const authoritativeNow = new Date();
      const authoritativeIsLate = authoritativeNow > authoritativeAssignment.dueAt;
      if (authoritativeIsLate && !authoritativeAssignment.allowLate) {
        throw new BadRequestException({
          code: 'PAST_DUE',
          message: 'The due date has passed and late submissions are not allowed',
        });
      }

      // Serialize against grading of an existing submission. For a first
      // submission the unique key still supplies the established one-row
      // upsert semantics for concurrent duplicate requests.
      await tx.$queryRaw`
        SELECT id FROM "Submission"
        WHERE "assignmentId" = ${assignmentId} AND "studentId" = ${student.id}
        FOR UPDATE`;
      const authoritativeExisting = await tx.submission.findUnique({
        where: {
          assignmentId_studentId: { assignmentId, studentId: student.id },
        },
        select: { id: true, gradedAt: true },
      });
      if (authoritativeExisting?.gradedAt) {
        throw new BadRequestException({
          code: 'ALREADY_GRADED',
          message: 'This submission has been graded and can no longer be changed',
        });
      }

      await tx.submission.upsert({
        where: {
          assignmentId_studentId: { assignmentId, studentId: student.id },
        },
        update: {
          textContent: input.textContent ?? null,
          fileUrl: input.fileUrl ?? null,
          fileName: input.fileName ?? null,
          submittedAt: authoritativeNow,
          isLate: authoritativeIsLate,
        },
        create: {
          assignmentId,
          studentId: student.id,
          textContent: input.textContent,
          fileUrl: input.fileUrl,
          fileName: input.fileName,
          submittedAt: authoritativeNow,
          isLate: authoritativeIsLate,
        },
      });
      return authoritativeExisting !== null;
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: wasResubmission ? 'submissions.resubmitted' : 'submissions.created',
      targetType: 'Assignment',
      targetId: assignmentId,
    });
    return this.detail(user, assignmentId);
  }

  async grade(
    user: AuthenticatedUser,
    submissionId: string,
    input: GradeSubmissionInput,
  ): Promise<SubmissionList> {
    const submission = await this.prisma.submission.findFirst({
      where: {
        id: submissionId,
        assignment: { section: { collegeId: user.collegeId } },
      },
      include: {
        assignment: {
          select: { id: true, sectionId: true, title: true, maxPoints: true },
        },
        student: { select: { userId: true } },
      },
    });
    if (!submission) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Submission not found',
      });
    }
    await this.lifecycle.assertSectionTermOpen(
      this.prisma,
      user.collegeId,
      submission.assignment.sectionId,
    );
    if (
      !(await this.policy.can(user, 'assignments.grade', {
        sectionId: submission.assignment.sectionId,
      }))
    ) {
      throw forbidden();
    }
    if (input.points > Number(submission.assignment.maxPoints)) {
      throw new BadRequestException({
        code: 'POINTS_EXCEED_MAX',
        message: `Points cannot exceed the maximum (${submission.assignment.maxPoints})`,
      });
    }

    const graded = await this.prisma.$transaction(async (tx) => {
      // M24-W3a (N-3 #14): the guard and checks above are preflights that
      // preserve established errors. This authoritative guard holds the Term
      // FOR SHARE through the grade write, serializing against term close.
      await this.lifecycle.assertSectionTermOpen(
        tx,
        user.collegeId,
        submission.assignment.sectionId,
      );

      // Freeze maxPoints/title while validating and grading, then serialize
      // concurrent grades of this Submission. Lock order: Term → Assignment
      // → Submission, matching submit's existing transaction order.
      await tx.$queryRaw`
        SELECT id FROM "Assignment"
        WHERE id = ${submission.assignment.id}
        FOR SHARE`;
      await tx.$queryRaw`
        SELECT id FROM "Submission"
        WHERE id = ${submissionId}
        FOR UPDATE`;
      const authoritative = await tx.submission.findFirst({
        where: {
          id: submissionId,
          assignment: {
            id: submission.assignment.id,
            section: { collegeId: user.collegeId },
          },
        },
        include: {
          assignment: {
            select: { id: true, sectionId: true, title: true, maxPoints: true },
          },
          student: { select: { userId: true } },
        },
      });
      if (!authoritative) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Submission not found',
        });
      }
      if (input.points > Number(authoritative.assignment.maxPoints)) {
        throw new BadRequestException({
          code: 'POINTS_EXCEED_MAX',
          message: `Points cannot exceed the maximum (${authoritative.assignment.maxPoints})`,
        });
      }

      await tx.submission.update({
        where: { id: submissionId },
        data: {
          points: input.points,
          feedback: input.feedback,
          gradedById: user.id,
          gradedAt: new Date(),
        },
      });
      return {
        studentUserId: authoritative.student.userId,
        assignmentId: authoritative.assignment.id,
        assignmentTitle: authoritative.assignment.title,
        maxPoints: authoritative.assignment.maxPoints.toString(),
      };
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'submissions.graded',
      targetType: 'Submission',
      targetId: submissionId,
      metadata: { points: input.points },
    });
    this.events.emit({
      type: 'assignment.graded',
      studentUserId: graded.studentUserId,
      assignmentId: graded.assignmentId,
      assignmentTitle: graded.assignmentTitle,
      points: String(input.points),
      maxPoints: graded.maxPoints,
    });
    return this.submissions(user, graded.assignmentId);
  }

  // ── access helpers ─────────────────────────────────────────

  private async findScoped(
    user: AuthenticatedUser,
    id: string,
  ): Promise<AssignmentRecord> {
    const scope = await this.policy.scopeFor(user, 'assignments.read');
    if (!scope) throw forbidden();
    const row = await this.prisma.assignment.findFirst({
      where: {
        id,
        section: { collegeId: user.collegeId },
        ...(scope === 'ASSIGNED'
          ? {
              section: {
                collegeId: user.collegeId,
                teachingAssignments: { some: { teacher: { userId: user.id } } },
              },
            }
          : {}),
        ...(scope === 'OWN'
          ? {
              publishedAt: { not: null },
              section: {
                collegeId: user.collegeId,
                enrollments: {
                  some: { student: { userId: user.id }, status: 'ACTIVE' },
                },
              },
            }
          : {}),
        // M13-W5: CHILD scope — published assignments in sections where an
        // ACTIVE-linked child of this guardian is enrolled. The link is the
        // authorizer (no client input); everything else reads as NOT_FOUND.
        ...(scope === 'CHILD'
          ? {
              publishedAt: { not: null },
              section: {
                collegeId: user.collegeId,
                enrollments: {
                  some: {
                    status: 'ACTIVE',
                    student: {
                      guardianLinks: {
                        some: { guardianUserId: user.id, status: 'ACTIVE' },
                      },
                    },
                  },
                },
              },
            }
          : {}),
      },
      include: assignmentInclude,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Assignment not found',
      });
    }
    return row;
  }

  private async requireManaged(user: AuthenticatedUser, id: string) {
    const row = await this.prisma.assignment.findFirst({
      where: { id, section: { collegeId: user.collegeId } },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Assignment not found',
      });
    }
    if (
      !(await this.policy.can(user, 'assignments.manage', {
        sectionId: row.sectionId,
      }))
    ) {
      throw forbidden();
    }
    return row;
  }

  private async requireGradable(user: AuthenticatedUser, id: string) {
    const row = await this.prisma.assignment.findFirst({
      where: { id, section: { collegeId: user.collegeId } },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Assignment not found',
      });
    }
    if (
      !(await this.policy.can(user, 'assignments.grade', {
        sectionId: row.sectionId,
      }))
    ) {
      throw forbidden();
    }
    return row;
  }
}
