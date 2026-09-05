import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateExamInput,
  CreateExamPaperInput,
  ExamAnalytics,
  ExamDetail,
  ExamItem,
  ExamPaperItem,
  GradeBandItem,
  GradeBandsUpdateInput,
  MarksSheet,
  PageMeta,
  PaginationQuery,
  ResultsResponse,
  SaveMarksInput,
  UpdateExamInput,
  UpdateExamPaperInput,
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

function forbidden(): ForbiddenException {
  return new ForbiddenException({
    code: 'FORBIDDEN',
    message: 'You do not have permission to perform this action',
  });
}

const paperInclude = {
  section: {
    include: {
      course: { select: { code: true, title: true } },
      _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
    },
  },
  _count: { select: { marks: true } },
} satisfies Prisma.ExamPaperInclude;

type PaperRecord = Prisma.ExamPaperGetPayload<{ include: typeof paperInclude }>;

@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: TermLifecycleService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  private toExamItem(row: {
    id: string;
    termId: string;
    term: { label: string };
    title: string;
    type: ExamItem['type'];
    status: ExamItem['status'];
    publishedAt: Date | null;
    _count: { papers: number };
  }, markCount: number): ExamItem {
    return {
      id: row.id,
      termId: row.termId,
      termLabel: row.term.label,
      title: row.title,
      type: row.type,
      status: row.status,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      paperCount: row._count.papers,
      markCount,
    };
  }

  private async toPaperItem(
    user: AuthenticatedUser,
    row: PaperRecord,
  ): Promise<ExamPaperItem> {
    return {
      id: row.id,
      examId: row.examId,
      sectionId: row.sectionId,
      courseCode: row.section.course.code,
      courseTitle: row.section.course.title,
      sectionName: row.section.name,
      examDate: row.examDate.toISOString(),
      maxMarks: row.maxMarks.toString(),
      room: row.room,
      enrolledCount: row.section._count.enrollments,
      markCount: row._count.marks,
      canEnterMarks: await this.policy.can(user, 'marks.enter', {
        sectionId: row.sectionId,
      }),
    };
  }

  // ── Exams ──────────────────────────────────────────────────

  /** ALL sees everything; ASSIGNED sees exams that have a paper in one of the caller's sections. */
  async list(
    user: AuthenticatedUser,
    query: PaginationQuery & { termId?: string },
  ): Promise<{ data: ExamItem[]; meta: PageMeta }> {
    const scope = await this.policy.scopeFor(user, 'marks.enter');
    if (!scope) throw forbidden();

    const where: Prisma.ExamWhereInput = {
      collegeId: user.collegeId,
      ...(query.termId ? { termId: query.termId } : {}),
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(scope === 'ASSIGNED'
        ? {
            papers: {
              some: {
                section: {
                  teachingAssignments: { some: { teacher: { userId: user.id } } },
                },
              },
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.exam.findMany({
        where,
        include: {
          term: { select: { label: true } },
          _count: { select: { papers: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...pageArgs(query),
      }),
      this.prisma.exam.count({ where }),
    ]);
    const markCounts = await this.prisma.mark.groupBy({
      by: ['examPaperId'],
      where: { examPaper: { examId: { in: rows.map((r) => r.id) } } },
      _count: true,
    });
    // Aggregate marks per exam.
    const paperExam = await this.prisma.examPaper.findMany({
      where: { examId: { in: rows.map((r) => r.id) } },
      select: { id: true, examId: true },
    });
    const examByPaper = new Map(paperExam.map((p) => [p.id, p.examId]));
    const marksByExam = new Map<string, number>();
    for (const entry of markCounts) {
      const examId = examByPaper.get(entry.examPaperId);
      if (!examId) continue;
      marksByExam.set(examId, (marksByExam.get(examId) ?? 0) + entry._count);
    }
    return {
      data: rows.map((row) => this.toExamItem(row, marksByExam.get(row.id) ?? 0)),
      meta: pageMeta(query, total),
    };
  }

  async detail(user: AuthenticatedUser, id: string): Promise<ExamDetail> {
    const scope = await this.policy.scopeFor(user, 'marks.enter');
    if (!scope) throw forbidden();
    const row = await this.prisma.exam.findFirst({
      where: {
        id,
        collegeId: user.collegeId,
        ...(scope === 'ASSIGNED'
          ? {
              papers: {
                some: {
                  section: {
                    teachingAssignments: { some: { teacher: { userId: user.id } } },
                  },
                },
              },
            }
          : {}),
      },
      include: {
        term: { select: { label: true } },
        _count: { select: { papers: true } },
        papers: { include: paperInclude, orderBy: { examDate: 'asc' } },
      },
    });
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Exam not found' });
    }
    const markCount = await this.prisma.mark.count({
      where: { examPaper: { examId: id } },
    });
    const papers: ExamPaperItem[] = [];
    for (const paper of row.papers) {
      papers.push(await this.toPaperItem(user, paper));
    }
    return { ...this.toExamItem(row, markCount), papers };
  }

  async create(user: AuthenticatedUser, input: CreateExamInput): Promise<ExamItem> {
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
    // M17-W2: exams cannot be created in a CLOSED term.
    await this.lifecycle.assertTermOpen(this.prisma, user.collegeId, input.termId);
    const created = await this.prisma.exam.create({
      data: {
        collegeId: user.collegeId,
        termId: input.termId,
        title: input.title,
        type: input.type,
      },
      include: {
        term: { select: { label: true } },
        _count: { select: { papers: true } },
      },
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'exams.created',
      targetType: 'Exam',
      targetId: created.id,
    });
    return this.toExamItem(created, 0);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateExamInput,
  ): Promise<ExamItem> {
    const existing = await this.requireExam(user, id);
    await this.lifecycle.assertTermOpen(this.prisma, user.collegeId, existing.termId);
    if (existing.status === 'PUBLISHED') {
      throw new BadRequestException({
        code: 'EXAM_PUBLISHED',
        message: 'Published exams cannot be modified',
      });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.exam.update({
        where: { id },
        data: { title: input.title, type: input.type, status: input.status },
        include: {
          term: { select: { label: true } },
          _count: { select: { papers: true } },
        },
      });
      // M23-W2 (S-2): exam definition changes were unaudited while
      // exams.created was not. Audited in-transaction; names only.
      await this.audit.logAtomic(
        {
          collegeId: user.collegeId,
          actorId: user.id,
          action: 'exams.updated',
          targetType: 'Exam',
          targetId: id,
          metadata: {
            termId: existing.termId,
            changed: changedFields(['title', 'type', 'status'], existing, {
              title: input.title,
              type: input.type,
              status: input.status,
            }),
          },
        },
        tx,
      );
      return row;
    });
    const markCount = await this.prisma.mark.count({
      where: { examPaper: { examId: id } },
    });
    return this.toExamItem(updated, markCount);
  }

  /**
   * Atomic publish (Blueprint W5): sets PUBLISHED + publishedAt/By and locks
   * every mark in one transaction. Emits results.published afterwards.
   */
  async publish(user: AuthenticatedUser, id: string): Promise<ExamItem> {
    const exam = await this.requireExam(user, id);
    await this.lifecycle.assertTermOpen(this.prisma, user.collegeId, exam.termId);
    if (exam.status === 'PUBLISHED') {
      throw new BadRequestException({
        code: 'ALREADY_PUBLISHED',
        message: 'This exam is already published',
      });
    }
    const paperCount = await this.prisma.examPaper.count({ where: { examId: id } });
    if (paperCount === 0) {
      throw new BadRequestException({
        code: 'NO_PAPERS',
        message: 'Add at least one paper before publishing',
      });
    }

    const now = new Date();
    const [updated] = await this.prisma.$transaction([
      this.prisma.exam.update({
        where: { id },
        data: { status: 'PUBLISHED', publishedAt: now, publishedById: user.id },
        include: {
          term: { select: { label: true } },
          _count: { select: { papers: true } },
        },
      }),
      this.prisma.mark.updateMany({
        where: { examPaper: { examId: id }, lockedAt: null },
        data: { lockedAt: now },
      }),
    ]);

    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'results.published',
      targetType: 'Exam',
      targetId: id,
    });

    const marked = await this.prisma.mark.findMany({
      where: { examPaper: { examId: id } },
      select: { student: { select: { userId: true } } },
      distinct: ['studentId'],
    });
    this.events.emit({
      type: 'results.published',
      examId: id,
      examTitle: updated.title,
      studentUserIds: marked.map((m) => m.student.userId),
    });

    const markCount = await this.prisma.mark.count({
      where: { examPaper: { examId: id } },
    });
    return this.toExamItem(updated, markCount);
  }

  // ── Papers ─────────────────────────────────────────────────

  async createPaper(
    user: AuthenticatedUser,
    examId: string,
    input: CreateExamPaperInput,
  ): Promise<ExamPaperItem> {
    const exam = await this.requireExam(user, examId);
    await this.lifecycle.assertTermOpen(this.prisma, user.collegeId, exam.termId);
    if (exam.status === 'PUBLISHED') {
      throw new BadRequestException({
        code: 'EXAM_PUBLISHED',
        message: 'Published exams cannot be modified',
      });
    }
    const section = await this.prisma.section.findFirst({
      where: { id: input.sectionId, collegeId: user.collegeId },
      select: { id: true, termId: true },
    });
    if (!section) {
      throw new BadRequestException({
        code: 'INVALID_SECTION',
        message: 'The selected section does not exist in this college',
      });
    }
    if (section.termId !== exam.termId) {
      throw new BadRequestException({
        code: 'TERM_MISMATCH',
        message: 'The section belongs to a different term than the exam',
      });
    }
    const duplicate = await this.prisma.examPaper.findUnique({
      where: { examId_sectionId: { examId, sectionId: input.sectionId } },
    });
    if (duplicate) {
      throw new BadRequestException({
        code: 'DUPLICATE_PAPER',
        message: 'This section already has a paper in this exam',
      });
    }
    const created = await this.prisma.examPaper.create({
      data: {
        examId,
        sectionId: input.sectionId,
        examDate: new Date(input.examDate),
        maxMarks: input.maxMarks,
        room: input.room,
        ...(input.weight !== undefined ? { weight: input.weight } : {}),
      },
      include: paperInclude,
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'exams.paper_created',
      targetType: 'ExamPaper',
      targetId: created.id,
    });
    return this.toPaperItem(user, created);
  }

  async updatePaper(
    user: AuthenticatedUser,
    examId: string,
    paperId: string,
    input: UpdateExamPaperInput,
  ): Promise<ExamPaperItem> {
    const exam = await this.requireExam(user, examId);
    await this.lifecycle.assertTermOpen(this.prisma, user.collegeId, exam.termId);
    if (exam.status === 'PUBLISHED') {
      throw new BadRequestException({
        code: 'EXAM_PUBLISHED',
        message: 'Published exams cannot be modified',
      });
    }
    const existing = await this.prisma.examPaper.findFirst({
      where: { id: paperId, examId },
    });
    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Paper not found' });
    }
    if (input.maxMarks !== undefined) {
      const over = await this.prisma.mark.findFirst({
        where: { examPaperId: paperId, marksObtained: { gt: input.maxMarks } },
      });
      if (over) {
        throw new BadRequestException({
          code: 'MAX_BELOW_MARKS',
          message: 'Max marks cannot be lower than an already-entered mark',
        });
      }
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.examPaper.update({
        where: { id: paperId },
        data: {
          examDate: input.examDate ? new Date(input.examDate) : undefined,
          maxMarks: input.maxMarks,
          room: input.room,
          weight: input.weight,
        },
        include: paperInclude,
      });
      // M23-W2 (S-2): paper schedule/max-marks changes affect how marks
      // are interpreted, so the change is now recorded (names only).
      await this.audit.logAtomic(
        {
          collegeId: user.collegeId,
          actorId: user.id,
          action: 'exams.paper_updated',
          targetType: 'ExamPaper',
          targetId: paperId,
          metadata: {
            examId,
            changed: changedFields(
              ['examDate', 'maxMarks', 'room', 'weight'],
              existing,
              {
                examDate: input.examDate ? new Date(input.examDate) : undefined,
                maxMarks: input.maxMarks,
                room: input.room,
                weight: input.weight,
              },
            ),
          },
        },
        tx,
      );
      return row;
    });
    return this.toPaperItem(user, updated);
  }

  // ── Marks ──────────────────────────────────────────────────

  async marksSheet(user: AuthenticatedUser, paperId: string): Promise<MarksSheet> {
    const paper = await this.requirePaperForMarks(user, paperId);
    const [enrollments, marks] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { sectionId: paper.sectionId, status: 'ACTIVE' },
        include: {
          student: {
            include: { user: { select: { firstName: true, lastName: true } } },
          },
        },
        orderBy: { student: { rollNo: 'asc' } },
      }),
      this.prisma.mark.findMany({ where: { examPaperId: paperId } }),
    ]);
    const markByStudent = new Map(marks.map((m) => [m.studentId, m]));

    return {
      paper: await this.toPaperItem(user, paper),
      examTitle: paper.exam.title,
      examStatus: paper.exam.status,
      locked: paper.exam.status === 'PUBLISHED',
      entries: enrollments.map((enrollment) => ({
        studentId: enrollment.studentId,
        name: `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`,
        rollNo: enrollment.student.rollNo,
        marksObtained:
          markByStudent.get(enrollment.studentId)?.marksObtained.toString() ??
          null,
      })),
    };
  }

  async saveMarks(
    user: AuthenticatedUser,
    paperId: string,
    input: SaveMarksInput,
  ): Promise<MarksSheet> {
    const paper = await this.requirePaperForMarks(user, paperId);
    await this.lifecycle.assertTermOpen(
      this.prisma,
      user.collegeId,
      paper.exam.termId,
    );
    if (paper.exam.status === 'PUBLISHED') {
      throw new BadRequestException({
        code: 'MARKS_LOCKED',
        message: 'Results are published — marks are locked',
      });
    }

    const max = Number(paper.maxMarks);
    const enrolled = await this.prisma.enrollment.findMany({
      where: { sectionId: paper.sectionId, status: 'ACTIVE' },
      select: { studentId: true },
    });
    const enrolledIds = new Set(enrolled.map((e) => e.studentId));
    for (const mark of input.marks) {
      if (!enrolledIds.has(mark.studentId)) {
        throw new BadRequestException({
          code: 'NOT_ENROLLED',
          message: 'One or more students are not enrolled in this section',
        });
      }
      if (mark.marksObtained > max) {
        throw new BadRequestException({
          code: 'MARKS_EXCEED_MAX',
          message: `Marks cannot exceed the paper maximum (${max})`,
        });
      }
    }

    await this.prisma.$transaction(
      input.marks.map((mark) =>
        this.prisma.mark.upsert({
          where: {
            examPaperId_studentId: {
              examPaperId: paperId,
              studentId: mark.studentId,
            },
          },
          update: { marksObtained: mark.marksObtained, enteredById: user.id },
          create: {
            examPaperId: paperId,
            studentId: mark.studentId,
            marksObtained: mark.marksObtained,
            enteredById: user.id,
          },
        }),
      ),
    );
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'marks.entered',
      targetType: 'ExamPaper',
      targetId: paperId,
      metadata: { count: input.marks.length },
    });
    return this.marksSheet(user, paperId);
  }

  // ── Results ────────────────────────────────────────────────

  async results(
    user: AuthenticatedUser,
    query: { studentId?: string; termId?: string },
  ): Promise<ResultsResponse> {
    const scope = await this.policy.scopeFor(user, 'results.read');
    if (!scope) throw forbidden();

    let studentProfileId = query.studentId;
    if (scope === 'OWN') {
      const own = await this.prisma.studentProfile.findFirst({
        where: { userId: user.id, collegeId: user.collegeId },
        select: { id: true },
      });
      if (!own) throw forbidden();
      studentProfileId = own.id; // OWN scope only ever reads itself
    }
    if (!studentProfileId) {
      throw new BadRequestException({
        code: 'MISSING_TARGET',
        message: 'Provide studentId',
      });
    }
    const student = await this.prisma.studentProfile.findFirst({
      where: { id: studentProfileId, collegeId: user.collegeId },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    if (!student) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Student not found' });
    }
    // M13-W3: CHILD scope — an ACTIVE GuardianLink to exactly this
    // profile, verified by PolicyService (never by client input).
    if (scope === 'CHILD') {
      const allowed = await this.policy.can(user, 'results.read', {
        studentProfileId,
      });
      if (!allowed) throw forbidden();
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

    // Students only ever see PUBLISHED results (Blueprint §5).
    const marks = await this.prisma.mark.findMany({
      where: {
        studentId: studentProfileId,
        examPaper: {
          exam: {
            status: 'PUBLISHED',
            collegeId: user.collegeId,
            ...(query.termId ? { termId: query.termId } : {}),
          },
        },
      },
      include: {
        examPaper: {
          include: {
            exam: { select: { id: true, title: true, type: true, termId: true } },
            section: {
              include: { course: { select: { code: true, title: true } } },
            },
          },
        },
      },
      orderBy: { examPaper: { examDate: 'asc' } },
    });

    const bands = await this.prisma.gradeBand.findMany({
      where: { collegeId: user.collegeId },
      orderBy: { sortOrder: 'asc' },
    });
    const bandFor = (percentage: number): string | null =>
      bands.find(
        (band) =>
          percentage >= Number(band.minPercent) &&
          percentage <= Number(band.maxPercent),
      )?.label ?? null;

    let totalObtained = 0;
    let totalMax = 0;
    const rows = marks.map((mark) => {
      const obtained = Number(mark.marksObtained);
      const max = Number(mark.examPaper.maxMarks);
      totalObtained += obtained;
      totalMax += max;
      const percentage = max > 0 ? Math.round((obtained / max) * 1000) / 10 : 0;
      return {
        examId: mark.examPaper.exam.id,
        examTitle: mark.examPaper.exam.title,
        examType: mark.examPaper.exam.type,
        courseCode: mark.examPaper.section.course.code,
        courseTitle: mark.examPaper.section.course.title,
        sectionName: mark.examPaper.section.name,
        marksObtained: mark.marksObtained.toString(),
        maxMarks: mark.examPaper.maxMarks.toString(),
        percentage,
        bandLabel: bandFor(percentage),
      };
    });
    const overallPercentage =
      totalMax > 0 ? Math.round((totalObtained / totalMax) * 1000) / 10 : null;

    let termLabel: string | null = null;
    if (query.termId) {
      const term = await this.prisma.term.findFirst({
        where: { id: query.termId, collegeId: user.collegeId },
        select: { label: true },
      });
      termLabel = term?.label ?? null;
    }

    return {
      studentId: studentProfileId,
      studentName: `${student.user.firstName} ${student.user.lastName}`,
      termId: query.termId ?? null,
      termLabel,
      rows,
      overall: {
        obtained: String(totalObtained),
        max: String(totalMax),
        percentage: overallPercentage,
        bandLabel:
          overallPercentage === null ? null : bandFor(overallPercentage),
      },
    };
  }

  async analytics(user: AuthenticatedUser, examId: string): Promise<ExamAnalytics> {
    // The exam is resolved through the established tenant-scoped helper,
    // so a foreign or unknown id is an indistinguishable 404.
    const exam = await this.requireExam(user, examId);
    // M24-W1 (N-13): analytics is a pure READ, so it is NOT gated on the
    // term being open. The previous `assertTermOpen` here threw
    // 409 TERM_CLOSED and made analytics permanently unreachable after the
    // sanctioned publish → close → finalize lifecycle, which is the exact
    // point it is most useful. Every other read path is likewise unguarded;
    // CLOSED-term enforcement remains on the write paths only.
    const papers = await this.prisma.examPaper.findMany({
      // M24-W1 (N-1, decision O-1): defence in depth. `examId` is now
      // validated as required at the controller, but `ExamPaper` carries no
      // `collegeId` of its own — it reaches a college only through `exam` —
      // so the tenancy predicate is stated explicitly here as well. Even if
      // a caller ever reached this query with a widened identifier, it can
      // no longer return another college's papers.
      where: { examId, exam: { collegeId: user.collegeId } },
      include: {
        section: { include: { course: { select: { code: true } } } },
        marks: true,
      },
    });
    const bands = await this.prisma.gradeBand.findMany({
      where: { collegeId: user.collegeId },
      orderBy: { sortOrder: 'asc' },
    });
    const distribution = new Map(bands.map((band) => [band.label, 0]));

    const paperStats = papers.map((paper) => {
      const values = paper.marks.map((mark) => Number(mark.marksObtained));
      const max = Number(paper.maxMarks);
      for (const value of values) {
        const percentage = max > 0 ? (value / max) * 100 : 0;
        const band = bands.find(
          (b) =>
            percentage >= Number(b.minPercent) &&
            percentage <= Number(b.maxPercent),
        );
        if (band) distribution.set(band.label, (distribution.get(band.label) ?? 0) + 1);
      }
      return {
        paperId: paper.id,
        courseCode: paper.section.course.code,
        sectionName: paper.section.name,
        maxMarks: paper.maxMarks.toString(),
        markCount: values.length,
        average:
          values.length > 0
            ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
            : null,
        highest: values.length > 0 ? Math.max(...values) : null,
        lowest: values.length > 0 ? Math.min(...values) : null,
      };
    });

    return {
      examId,
      title: exam.title,
      status: exam.status,
      papers: paperStats,
      bandDistribution: bands.map((band) => ({
        label: band.label,
        count: distribution.get(band.label) ?? 0,
      })),
    };
  }

  // ── Grade bands ────────────────────────────────────────────

  async gradeBands(user: AuthenticatedUser): Promise<GradeBandItem[]> {
    const bands = await this.prisma.gradeBand.findMany({
      where: { collegeId: user.collegeId },
      orderBy: { sortOrder: 'asc' },
    });
    return bands.map((band) => ({
      id: band.id,
      label: band.label,
      minPercent: band.minPercent.toString(),
      maxPercent: band.maxPercent.toString(),
      sortOrder: band.sortOrder,
    }));
  }

  async updateGradeBands(
    user: AuthenticatedUser,
    input: GradeBandsUpdateInput,
  ): Promise<GradeBandItem[]> {
    // Non-overlap check (bands sorted by minPercent).
    const sorted = [...input.bands].sort((a, b) => a.minPercent - b.minPercent);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].minPercent <= sorted[i - 1].maxPercent) {
        throw new BadRequestException({
          code: 'BANDS_OVERLAP',
          message: `Bands "${sorted[i - 1].label}" and "${sorted[i].label}" overlap`,
        });
      }
    }
    // M24-W3b (N-11, coverage half): the overlap rule above rejected
    // double-covered percentages but permitted GAPS, so a percentage
    // could fall into no band at all and `bandFor` would return null —
    // a result silently losing its grade label.
    //
    // The contiguity rule follows the EXISTING representation rather than
    // inventing a convention: minPercent/maxPercent are Decimal(5,2)
    // inclusive bounds, so the smallest representable step is 0.01, and
    // the overlap rule already forces each band to start strictly above
    // the previous one. Adjacent bands must therefore begin exactly one
    // step after the previous band ends — precisely how the seeded scale
    // is expressed (F[0,49.99] D[50,59.99] … A+[90,100]). Coverage must
    // also span the whole domain, 0 through 100.
    //
    // SCOPE: this validates the SHAPE of the configuration only. Whether
    // a band edit should be permitted at all once results are published
    // is a separate product decision and remains DEFERRED to M25 —
    // boundary changes against published results stay allowed here.
    const STEP = 0.01;
    const round2 = (value: number) => Math.round(value * 100) / 100;
    const notContiguous = (message: string): never => {
      throw new BadRequestException({ code: 'BANDS_NOT_CONTIGUOUS', message });
    };
    if (round2(sorted[0].minPercent) !== 0) {
      notContiguous(
        `Grade bands must start at 0% — the lowest band "${sorted[0].label}" starts at ${sorted[0].minPercent}%`,
      );
    }
    const highest = sorted[sorted.length - 1];
    if (round2(highest.maxPercent) !== 100) {
      notContiguous(
        `Grade bands must reach 100% — the highest band "${highest.label}" ends at ${highest.maxPercent}%`,
      );
    }
    for (let i = 1; i < sorted.length; i += 1) {
      if (round2(sorted[i].minPercent) !== round2(sorted[i - 1].maxPercent + STEP)) {
        notContiguous(
          `Grade bands leave a gap between "${sorted[i - 1].label}" (ends ${sorted[i - 1].maxPercent}%) and "${sorted[i].label}" (starts ${sorted[i].minPercent}%)`,
        );
      }
    }
    // M23-W3 (D-2): the replacement semantics are preserved (bands are
    // still deleted and recreated), but `gradePoint` is now carried
    // forward instead of being silently dropped. Previously createMany
    // omitted the column entirely, so EVERY grade-band edit reset the
    // whole configured GPA scale to null and CGPA silently became
    // unavailable (results-finalization only computes a GPA when every
    // course line carries a point — M18 O-4).
    //
    // Bands are matched by `label`, which is the existing per-college
    // identity of a band (`@@unique([collegeId, label])`). A label that
    // did not exist before gets null: CampusOS never invents a
    // grade-point scale, and `gradePoint` deliberately stays
    // server-managed — it is absent from `gradeBandsUpdateSchema`, so a
    // client cannot set or forge it here. Read/write contracts are
    // unchanged.
    await this.prisma.$transaction(async (tx) => {
      const previous = await tx.gradeBand.findMany({
        where: { collegeId: user.collegeId },
        select: { label: true, gradePoint: true },
      });
      const pointsByLabel = new Map(
        previous.map((band) => [band.label, band.gradePoint]),
      );
      await tx.gradeBand.deleteMany({ where: { collegeId: user.collegeId } });
      await tx.gradeBand.createMany({
        data: sorted
          .slice()
          .reverse()
          .map((band, index) => ({
            collegeId: user.collegeId,
            label: band.label,
            minPercent: band.minPercent,
            maxPercent: band.maxPercent,
            gradePoint: pointsByLabel.get(band.label) ?? null,
            sortOrder: index + 1,
          })),
      });
      const preserved = sorted.filter(
        (band) => (pointsByLabel.get(band.label) ?? null) !== null,
      ).length;
      // Audit joins the same transaction (M23-W2 discipline): the record
      // exists iff the replacement committed. Counts only — no labels,
      // no thresholds, no client payload.
      await this.audit.logAtomic(
        {
          collegeId: user.collegeId, // server-derived tenant
          actorId: user.id, // server-derived principal
          action: 'grade_bands.updated',
          metadata: {
            bandCountBefore: previous.length,
            bandCountAfter: sorted.length,
            gradePointsPreserved: preserved,
          },
        },
        tx,
      );
    });
    return this.gradeBands(user);
  }

  // ── helpers ────────────────────────────────────────────────

  private async requireExam(user: AuthenticatedUser, id: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id, collegeId: user.collegeId },
    });
    if (!exam) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Exam not found' });
    }
    return exam;
  }

  private async requirePaperForMarks(user: AuthenticatedUser, paperId: string) {
    const paper = await this.prisma.examPaper.findFirst({
      where: { id: paperId, exam: { collegeId: user.collegeId } },
      include: {
        ...paperInclude,
        exam: { select: { id: true, title: true, status: true, termId: true } },
      },
    });
    if (!paper) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Paper not found' });
    }
    if (
      !(await this.policy.can(user, 'marks.enter', { sectionId: paper.sectionId }))
    ) {
      throw forbidden();
    }
    return paper;
  }
}
