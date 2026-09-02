import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../access/policy.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../access/authenticated-user';

/**
 * M18-W1 — academic result finalization engine
 * (docs/M18_ACADEMIC_RECORDS_DESIGN.md, decisions O-1…O-6).
 *
 * Invariants:
 *  - A snapshot is created ONLY for a CLOSED term (O-1: publish → close
 *    → finalize), verified against the LOCKED Term row (FOR SHARE)
 *    inside the finalization transaction.
 *  - Snapshots are computed exclusively from PUBLISHED exams' locked
 *    marks plus the student's enrollment/attendance in that term —
 *    never from client input.
 *  - TermResult/CourseResult are IMMUTABLE after creation. Corrections
 *    create version N+1 and CAS the old row FINALIZED→SUPERSEDED; every
 *    historical version remains readable forever. Term reopening never
 *    touches snapshots (O-6).
 *  - Concurrency: the DB partial unique index
 *    `TermResult_one_finalized_per_student_term` is the finalization
 *    CAS — concurrent finalizations collapse to one winner + one 409.
 *  - GPA (O-4, credit-weighted): computed ONLY when the college has
 *    configured GradeBand.gradePoint. The seed ships gradePoint = null,
 *    so GPA fields stay null until the institution defines its official
 *    scale — CampusOS never invents a grading policy.
 *  - Tenancy: student and term resolved via user.collegeId; foreign ids
 *    are indistinguishable 404s. No financial tables are read or locked.
 */

const notFound = (what: string) =>
  new NotFoundException({ code: 'NOT_FOUND', message: `${what} not found` });

interface FrozenCourse {
  courseId: string;
  sectionId: string;
  courseCode: string;
  courseTitle: string;
  credits: number;
  obtained: number;
  maxMarks: number;
  percentage: number;
  gradeLabel: string | null;
  gradePoint: number | null;
  passed: boolean | null;
}

@Injectable()
export class ResultsFinalizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  // ── finalize (creates version 1) ─────────────────────────────

  async finalize(
    user: AuthenticatedUser,
    termId: string,
    studentId: string,
    confirmLabel: string,
  ) {
    const { term, student } = await this.resolveTargets(user, termId, studentId);
    if (confirmLabel !== term.label) {
      throw new BadRequestException({
        code: 'CONFIRMATION_MISMATCH',
        message: 'Type the exact term label to confirm',
      });
    }
    const record = await this.createSnapshot(user, term, student, 1, null);
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'results.finalized',
      targetType: 'TermResult',
      targetId: record.id,
      metadata: { studentId, termId, version: record.version },
    });
    return this.toItem(record);
  }

  // ── amend (version N+1 supersedes N; W1 foundation) ──────────

  async amend(
    user: AuthenticatedUser,
    termResultId: string,
    reason: string,
    confirmLabel: string,
  ) {
    const existing = await this.prisma.termResult.findFirst({
      where: { id: termResultId, collegeId: user.collegeId },
      include: { term: { select: { id: true, label: true, status: true } } },
    });
    if (!existing) throw notFound('Result');
    if (confirmLabel !== existing.term.label) {
      throw new BadRequestException({
        code: 'CONFIRMATION_MISMATCH',
        message: 'Type the exact term label to confirm',
      });
    }
    if (existing.status !== 'FINALIZED') {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: 'Only the active finalized version can be amended',
      });
    }
    const { term, student } = await this.resolveTargets(
      user,
      existing.termId,
      existing.studentId,
    );
    const record = await this.createSnapshot(
      user,
      term,
      student,
      existing.version + 1,
      existing.id,
      reason,
    );
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'results.amended',
      targetType: 'TermResult',
      targetId: record.id,
      metadata: {
        supersedes: existing.id,
        studentId: existing.studentId,
        termId: existing.termId,
        version: record.version,
      },
    });
    return this.toItem(record);
  }


  // ── M18-W2: batch finalization (same engine, per-student txs) ─

  async finalizeBatch(
    user: AuthenticatedUser,
    termId: string,
    studentIds: string[],
    confirmLabel: string,
  ) {
    const term = await this.prisma.term.findFirst({
      where: { id: termId, collegeId: user.collegeId },
      select: { id: true, label: true },
    });
    if (!term) throw notFound('Term');
    if (confirmLabel !== term.label) {
      throw new BadRequestException({
        code: 'CONFIRMATION_MISMATCH',
        message: 'Type the exact term label to confirm',
      });
    }
    const outcomes: Array<{
      studentId: string;
      finalized: boolean;
      errorCode?: string;
    }> = [];
    for (const studentId of studentIds) {
      try {
        // The SAME single-student engine and invariants — each student in
        // its own atomic transaction; a failure never touches the others.
        await this.finalize(user, termId, studentId, confirmLabel);
        outcomes.push({ studentId, finalized: true });
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'getResponse' in error
            ? ((error as { getResponse(): { code?: string } }).getResponse()
                .code ?? 'FAILED')
            : 'FAILED';
        outcomes.push({ studentId, finalized: false, errorCode: code });
      }
    }
    return {
      termId,
      finalized: outcomes.filter((o) => o.finalized).length,
      failed: outcomes.filter((o) => !o.finalized).length,
      outcomes,
    };
  }

  // ── M18-W2: VOID (design §13 — preserves history, never deletes) ─

  async void(
    user: AuthenticatedUser,
    termResultId: string,
    reason: string,
    confirmLabel: string,
  ) {
    const existing = await this.prisma.termResult.findFirst({
      where: { id: termResultId, collegeId: user.collegeId },
      include: {
        term: { select: { label: true } },
        courseResults: true,
      },
    });
    if (!existing) throw notFound('Result');
    if (confirmLabel !== existing.term.label) {
      throw new BadRequestException({
        code: 'CONFIRMATION_MISMATCH',
        message: 'Type the exact term label to confirm',
      });
    }
    // CAS: only the active FINALIZED version can be voided; SUPERSEDED
    // history and already-VOID rows are untouchable. The row itself is
    // preserved forever — VOID is a status, never a delete.
    const voided = await this.prisma.termResult.updateMany({
      where: { id: termResultId, status: 'FINALIZED' },
      data: { status: 'VOID' },
    });
    if (voided.count === 0) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: 'Only the active finalized version can be voided',
      });
    }
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'results.voided',
      targetType: 'TermResult',
      targetId: termResultId,
      metadata: {
        studentId: existing.studentId,
        termId: existing.termId,
        version: existing.version,
      },
    });
    const current = await this.prisma.termResult.findUniqueOrThrow({
      where: { id: termResultId },
      include: { courseResults: true },
    });
    return this.toItem(current);
  }

  // ── M18-W2: reads (results.read OWN/CHILD/ASSIGNED/ALL — exams.results
  //    precedent; snapshots ONLY, never rebuilt from mutable marks) ─

  /** Resolve the target student under the caller's results.read scope. */
  private async resolveReadTarget(
    user: AuthenticatedUser,
    requestedStudentId?: string,
  ): Promise<string> {
    const scope = await this.policy.scopeFor(user, 'results.read');
    if (!scope) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    }
    if (scope === 'OWN') {
      const own = await this.prisma.studentProfile.findFirst({
        where: { userId: user.id, collegeId: user.collegeId },
        select: { id: true },
      });
      if (!own) throw notFound('Student');
      return own.id; // OWN only ever reads itself — requested ids ignored
    }
    if (!requestedStudentId) {
      throw new BadRequestException({
        code: 'MISSING_TARGET',
        message: 'Provide studentId',
      });
    }
    const student = await this.prisma.studentProfile.findFirst({
      where: { id: requestedStudentId, collegeId: user.collegeId },
      select: { id: true },
    });
    if (!student) throw notFound('Student');
    if (scope === 'CHILD') {
      const allowed = await this.policy.can(user, 'results.read', {
        studentProfileId: student.id,
      });
      if (!allowed) throw notFound('Student');
    }
    // M23-W1 (S-1): ASSIGNED must narrow to the authoritative teaching
    // relationship. Before this fix ASSIGNED fell through to the bare
    // same-college lookup above, so any teacher could read any
    // same-college student's finalized report card and transcript — an
    // intra-tenant horizontal over-read. The relationship is the same
    // server-derived one already enforced for live marks
    // (exams.service.results) and attendance summaries: an ACTIVE
    // Enrollment in a Section the caller holds a TeachingAssignment for.
    // Teacher identity comes from the authenticated session (userId),
    // never from client input.
    if (scope === 'ASSIGNED') {
      const shared = await this.prisma.enrollment.findFirst({
        where: {
          studentId: student.id,
          status: 'ACTIVE',
          section: {
            collegeId: user.collegeId,
            teachingAssignments: { some: { teacher: { userId: user.id } } },
          },
        },
        select: { id: true },
      });
      // Same denial shape as CHILD/unknown-student above: an
      // unassigned student is indistinguishable from a nonexistent one,
      // so the fix adds no enumeration signal.
      if (!shared) throw notFound('Student');
    }
    return student.id;
  }

  /** Finalized term report card (the immutable snapshot — O-2). */
  async report(
    user: AuthenticatedUser,
    termId: string,
    requestedStudentId?: string,
  ) {
    const studentId = await this.resolveReadTarget(user, requestedStudentId);
    const record = await this.prisma.termResult.findFirst({
      where: {
        collegeId: user.collegeId,
        termId,
        studentId,
        status: 'FINALIZED',
      },
      include: {
        courseResults: { orderBy: { courseCode: 'asc' } },
        term: { select: { label: true } },
        student: {
          select: {
            rollNo: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!record) {
      throw new NotFoundException({
        code: 'NOT_FINALIZED',
        message: 'No finalized result exists for this term',
      });
    }
    return {
      ...this.toItem(record),
      termLabel: record.term.label,
      studentName: `${record.student.user.firstName} ${record.student.user.lastName}`,
      rollNo: record.student.rollNo,
    };
  }

  /**
   * Transcript (O-3): dynamically assembled from FINALIZED snapshots
   * ONLY (SUPERSEDED and VOID excluded). CGPA is credit-weighted across
   * finalized course lines and computed ONLY when EVERY line carries a
   * configured grade point — a partially configured scale yields null
   * rather than a misleading number (no invented policy). All attempts
   * remain visible; no repeat-course replacement (deferred by design).
   */
  async transcript(user: AuthenticatedUser, requestedStudentId?: string) {
    const studentId = await this.resolveReadTarget(user, requestedStudentId);
    const student = await this.prisma.studentProfile.findFirstOrThrow({
      where: { id: studentId },
      select: {
        rollNo: true,
        admissionNo: true,
        status: true,
        user: { select: { firstName: true, lastName: true } },
      },
    });
    const records = await this.prisma.termResult.findMany({
      where: { collegeId: user.collegeId, studentId, status: 'FINALIZED' },
      include: {
        courseResults: { orderBy: { courseCode: 'asc' } },
        term: { select: { label: true, startsOn: true } },
      },
      orderBy: { term: { startsOn: 'asc' } },
    });
    const allCourses = records.flatMap((r) => r.courseResults);
    const creditsAttempted = allCourses.reduce((s, c) => s + c.credits, 0);
    const everyPointed =
      allCourses.length > 0 && allCourses.every((c) => c.gradePoint !== null);
    const cgpa = everyPointed
      ? round2(
          allCourses.reduce(
            (s, c) => s + Number(c.gradePoint) * c.credits,
            0,
          ) / creditsAttempted,
        )
      : null;
    const creditsEarned = everyPointed
      ? allCourses.reduce((s, c) => s + (c.passed ? c.credits : 0), 0)
      : null;
    return {
      studentId,
      studentName: `${student.user.firstName} ${student.user.lastName}`,
      rollNo: student.rollNo,
      admissionNo: student.admissionNo,
      academicStatus: student.status,
      creditsAttempted,
      creditsEarned,
      cgpa: cgpa !== null ? cgpa.toFixed(2) : null,
      terms: records.map((record) => ({
        termLabel: record.term.label,
        ...this.toItem(record),
      })),
    };
  }

  /** Staff finalization worklist for a term (results.finalize). */
  async finalizationList(user: AuthenticatedUser, termId: string) {
    const term = await this.prisma.term.findFirst({
      where: { id: termId, collegeId: user.collegeId },
      select: { id: true, label: true, status: true },
    });
    if (!term) throw notFound('Term');
    const students = await this.prisma.studentProfile.findMany({
      where: {
        collegeId: user.collegeId,
        enrollments: { some: { section: { termId } } },
      },
      select: {
        id: true,
        rollNo: true,
        user: { select: { firstName: true, lastName: true } },
      },
      orderBy: { rollNo: 'asc' },
    });
    const results = await this.prisma.termResult.findMany({
      where: { collegeId: user.collegeId, termId },
      select: { studentId: true, status: true, version: true },
    });
    const byStudent = new Map(
      results
        .filter((r) => r.status === 'FINALIZED')
        .map((r) => [r.studentId, r]),
    );
    return {
      termId: term.id,
      termLabel: term.label,
      termStatus: term.status,
      students: students.map((s) => ({
        studentId: s.id,
        name: `${s.user.firstName} ${s.user.lastName}`,
        rollNo: s.rollNo,
        finalized: byStudent.has(s.id),
        version: byStudent.get(s.id)?.version ?? null,
      })),
    };
  }

  // ── internals ────────────────────────────────────────────────

  private async resolveTargets(
    user: AuthenticatedUser,
    termId: string,
    studentId: string,
  ) {
    const term = await this.prisma.term.findFirst({
      where: { id: termId, collegeId: user.collegeId },
      select: { id: true, label: true, status: true },
    });
    if (!term) throw notFound('Term');
    const student = await this.prisma.studentProfile.findFirst({
      where: { id: studentId, collegeId: user.collegeId },
      select: { id: true },
    });
    if (!student) throw notFound('Student');
    return { term, student };
  }

  /**
   * One atomic transaction: lock the Term (FOR SHARE — serializes with
   * M17 close/reopen's FOR UPDATE), re-check CLOSED, compute the frozen
   * result from authoritative data, insert TermResult + CourseResult
   * rows, and (for amendments) CAS-supersede the previous version.
   * Validation failures create nothing; the partial unique index makes
   * duplicate finalizations impossible under any concurrency.
   */
  private async createSnapshot(
    user: AuthenticatedUser,
    term: { id: string; label: string },
    student: { id: string },
    version: number,
    supersedesId: string | null,
    remark?: string,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // O-1: finalization targets CLOSED terms only — authoritative,
        // locked re-read (never a preflight).
        const locked = await tx.$queryRaw<Array<{ status: string }>>`
          SELECT "status" FROM "Term" WHERE id = ${term.id} FOR SHARE`;
        if (locked.length === 0) throw notFound('Term');
        if (locked[0].status !== 'CLOSED') {
          throw new ConflictException({
            code: 'TERM_NOT_CLOSED',
            message:
              'Results can only be finalized for a closed term — close it first',
          });
        }

        const courses = await this.freezeCourses(tx, user.collegeId, term.id, student.id);
        if (courses.length === 0) {
          throw new BadRequestException({
            code: 'NO_PUBLISHED_RESULTS',
            message:
              'This student has no published exam results in this term',
          });
        }

        const totals = courses.reduce(
          (acc, c) => ({
            obtained: acc.obtained + c.obtained,
            max: acc.max + c.maxMarks,
            credits: acc.credits + c.credits,
            weighted:
              c.gradePoint !== null && acc.weighted !== null
                ? acc.weighted + c.gradePoint * c.credits
                : null,
            earned:
              c.passed === null || acc.earned === null
                ? null
                : acc.earned + (c.passed ? c.credits : 0),
          }),
          {
            obtained: 0,
            max: 0,
            credits: 0,
            weighted: 0 as number | null,
            earned: 0 as number | null,
          },
        );
        const overallPercentage =
          totals.max > 0 ? round2((totals.obtained / totals.max) * 100) : 0;
        const bands = await tx.gradeBand.findMany({
          where: { collegeId: user.collegeId },
        });
        const overallBand = bandFor(bands, overallPercentage);
        // O-4: credit-weighted GPA — ONLY when the institution has
        // configured grade points; otherwise honestly null.
        const termGpa =
          totals.weighted !== null && totals.credits > 0
            ? round2(totals.weighted / totals.credits)
            : null;

        const attendance = await this.attendancePercent(tx, term.id, student.id);

        // Amendment: CAS the previous FINALIZED version out of the way
        // first (frees the partial unique slot atomically in this tx).
        if (supersedesId) {
          const superseded = await tx.termResult.updateMany({
            where: { id: supersedesId, status: 'FINALIZED' },
            data: { status: 'SUPERSEDED' },
          });
          if (superseded.count === 0) {
            throw new ConflictException({
              code: 'INVALID_TRANSITION',
              message: 'This result version was already superseded',
            });
          }
        }

        const record = await tx.termResult.create({
          data: {
            collegeId: user.collegeId,
            studentId: student.id,
            termId: term.id,
            version,
            overallPercentage: new Prisma.Decimal(overallPercentage.toFixed(2)),
            gradeLabel: overallBand?.label ?? null,
            gradePoint:
              overallBand?.gradePoint !== null && overallBand !== null
                ? overallBand.gradePoint
                : null,
            termGpa: termGpa !== null ? new Prisma.Decimal(termGpa.toFixed(2)) : null,
            creditsAttempted: totals.credits,
            creditsEarned: totals.earned,
            attendancePercent:
              attendance !== null ? new Prisma.Decimal(attendance.toFixed(2)) : null,
            remark: remark ?? null,
            finalizedById: user.id,
            finalizedAt: new Date(),
            courseResults: {
              create: courses.map((c) => ({
                courseId: c.courseId,
                sectionId: c.sectionId,
                courseCode: c.courseCode,
                courseTitle: c.courseTitle,
                credits: c.credits,
                obtained: new Prisma.Decimal(c.obtained.toFixed(2)),
                maxMarks: new Prisma.Decimal(c.maxMarks.toFixed(2)),
                percentage: new Prisma.Decimal(c.percentage.toFixed(2)),
                gradeLabel: c.gradeLabel,
                gradePoint:
                  c.gradePoint !== null ? new Prisma.Decimal(c.gradePoint) : null,
                passed: c.passed,
              })),
            },
          },
          include: { courseResults: true },
        });
        if (supersedesId) {
          // Chain: old row points at its replacement (unique, Restrict).
          await tx.termResult.update({
            where: { id: supersedesId },
            data: { supersededById: record.id },
          });
        }
        return record;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Partial unique: one FINALIZED per (student, term). Concurrent
        // finalizations collapse here — the loser created NOTHING.
        throw new ConflictException({
          code: 'ALREADY_FINALIZED',
          message: 'A finalized result already exists for this student and term',
        });
      }
      throw error;
    }
  }

  /** Freeze per-course lines from PUBLISHED exams' locked marks. */
  private async freezeCourses(
    tx: Prisma.TransactionClient,
    collegeId: string,
    termId: string,
    studentId: string,
  ): Promise<FrozenCourse[]> {
    const marks = await tx.mark.findMany({
      where: {
        studentId,
        examPaper: {
          exam: { collegeId, termId, status: 'PUBLISHED' },
        },
      },
      include: {
        examPaper: {
          select: {
            maxMarks: true,
            sectionId: true,
            section: {
              select: {
                id: true,
                course: {
                  select: { id: true, code: true, title: true, credits: true },
                },
              },
            },
          },
        },
      },
    });
    const bands = await tx.gradeBand.findMany({ where: { collegeId } });
    const byCourse = new Map<string, FrozenCourse>();
    for (const mark of marks) {
      const course = mark.examPaper.section.course;
      const entry = byCourse.get(course.id) ?? {
        courseId: course.id,
        sectionId: mark.examPaper.sectionId,
        courseCode: course.code,
        courseTitle: course.title,
        credits: course.credits,
        obtained: 0,
        maxMarks: 0,
        percentage: 0,
        gradeLabel: null,
        gradePoint: null,
        passed: null,
      };
      entry.obtained += Number(mark.marksObtained);
      entry.maxMarks += Number(mark.examPaper.maxMarks);
      byCourse.set(course.id, entry);
    }
    for (const entry of byCourse.values()) {
      entry.percentage =
        entry.maxMarks > 0 ? round2((entry.obtained / entry.maxMarks) * 100) : 0;
      const band = bandFor(bands, entry.percentage);
      entry.gradeLabel = band?.label ?? null;
      entry.gradePoint = band?.gradePoint ?? null;
      // Pass/fail derives from grade points ONLY when the institution
      // defined them (gradePoint > 0 = passed); otherwise unknown (null)
      // — CampusOS does not invent a pass mark (design O-4 boundary).
      entry.passed = entry.gradePoint !== null ? entry.gradePoint > 0 : null;
    }
    return [...byCourse.values()];
  }

  private async attendancePercent(
    tx: Prisma.TransactionClient,
    termId: string,
    studentId: string,
  ): Promise<number | null> {
    const [total, present] = await Promise.all([
      tx.attendanceRecord.count({
        where: {
          studentId,
          session: { status: 'HELD', section: { termId } },
        },
      }),
      tx.attendanceRecord.count({
        where: {
          studentId,
          session: { status: 'HELD', section: { termId } },
          status: { in: ['PRESENT', 'LATE'] },
        },
      }),
    ]);
    if (total === 0) return null;
    return round2((present / total) * 100);
  }

  private toItem(record: {
    id: string;
    studentId: string;
    termId: string;
    status: string;
    version: number;
    overallPercentage: Prisma.Decimal;
    gradeLabel: string | null;
    gradePoint: Prisma.Decimal | null;
    termGpa: Prisma.Decimal | null;
    creditsAttempted: number;
    creditsEarned: number | null;
    attendancePercent: Prisma.Decimal | null;
    finalizedAt: Date;
    courseResults: Array<{
      courseCode: string;
      courseTitle: string;
      credits: number;
      obtained: Prisma.Decimal;
      maxMarks: Prisma.Decimal;
      percentage: Prisma.Decimal;
      gradeLabel: string | null;
      gradePoint: Prisma.Decimal | null;
      passed: boolean | null;
    }>;
  }) {
    return {
      id: record.id,
      studentId: record.studentId,
      termId: record.termId,
      status: record.status,
      version: record.version,
      overallPercentage: record.overallPercentage.toString(),
      gradeLabel: record.gradeLabel,
      gradePoint: record.gradePoint?.toString() ?? null,
      termGpa: record.termGpa?.toString() ?? null,
      creditsAttempted: record.creditsAttempted,
      creditsEarned: record.creditsEarned,
      attendancePercent: record.attendancePercent?.toString() ?? null,
      finalizedAt: record.finalizedAt.toISOString(),
      courses: record.courseResults.map((c) => ({
        courseCode: c.courseCode,
        courseTitle: c.courseTitle,
        credits: c.credits,
        obtained: c.obtained.toString(),
        maxMarks: c.maxMarks.toString(),
        percentage: c.percentage.toString(),
        gradeLabel: c.gradeLabel,
        gradePoint: c.gradePoint?.toString() ?? null,
        passed: c.passed,
      })),
    };
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function bandFor(
  bands: Array<{
    label: string;
    minPercent: Prisma.Decimal;
    maxPercent: Prisma.Decimal;
    gradePoint: Prisma.Decimal | null;
  }>,
  percentage: number,
): { label: string; gradePoint: number | null } | null {
  const band = bands.find(
    (b) =>
      percentage >= Number(b.minPercent) && percentage <= Number(b.maxPercent),
  );
  if (!band) return null;
  return {
    label: band.label,
    gradePoint: band.gradePoint !== null ? Number(band.gradePoint) : null,
  };
}
