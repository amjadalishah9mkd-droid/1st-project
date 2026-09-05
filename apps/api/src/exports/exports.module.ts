import {
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import type { PermissionKey } from '@campusos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../access/policy.service';
import { AuditService } from '../audit/audit.service';
import { toCsv, CsvTooLargeError, CSV_ROW_CAP } from '../common/csv';
import { netPaid } from '../fees/money';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

/**
 * M12-W3 — CSV exports (decision A3: admin-only in v1).
 *
 * Authorization is PolicyService-only and data-driven: each endpoint
 * requires the caller's RESOLVED scope for the relevant permission to be
 * 'ALL'. (Students hold these permissions with OWN scope and teachers with
 * ASSIGNED scope — both are refused; no role conditionals anywhere.)
 * Every query is tenant-scoped by the session's collegeId; foreign ids
 * simply produce empty result sets. Responses bypass the JSON envelope
 * (text/csv attachment), following the GET /files/:key precedent.
 */
const studentsQuery = z.object({
  departmentId: z.string().optional(),
  batch: z.string().max(20).optional(),
});
// M24-W1 (N-5): the same calendar round-trip check the shared `isoDate`
// primitive uses. Previously a syntactically-valid but impossible date
// (`2024-13-45`) reached Prisma as `Invalid Date` and returned a 500.
const isoDateFilter = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, 'Not a real calendar date');
const attendanceQuery = z.object({
  sectionId: z.string().optional(),
  from: isoDateFilter.optional(),
  to: isoDateFilter.optional(),
});
const feesQuery = z.object({
  status: z
    .enum(['PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED'])
    .optional(),
  termId: z.string().optional(),
});
const resultsQuery = z.object({ examId: z.string().min(1) });
// M16-W5 — refund export filters mirror the reconciliation Refunds view.
const refundsQuery = z.object({
  status: z
    .enum(['REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED'])
    .optional(),
  method: z.enum(['PROVIDER', 'RECORDED']).optional(),
});

@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  /** A3: exports require resolved scope ALL for the backing permission. */
  async assertAllScope(
    user: AuthenticatedUser,
    permission: PermissionKey,
  ): Promise<void> {
    const scope = await this.policy.scopeFor(user, permission);
    if (scope !== 'ALL') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Exports require college-wide access',
      });
    }
  }

  private async logExport(
    user: AuthenticatedUser,
    exportName: string,
    rowCount: number,
  ): Promise<void> {
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'exports.generated',
      targetType: 'Export',
      metadata: { export: exportName, rows: rowCount },
    });
  }

  async students(
    user: AuthenticatedUser,
    query: z.infer<typeof studentsQuery>,
  ): Promise<string> {
    await this.assertAllScope(user, 'users.read');
    const rows = await this.prisma.studentProfile.findMany({
      where: {
        collegeId: user.collegeId,
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.batch ? { batch: query.batch } : {}),
      },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        department: { select: { name: true } },
      },
      orderBy: { rollNo: 'asc' },
      // F1: cap materialization memory, not just the response.
      take: CSV_ROW_CAP + 1,
    });
    const csv = toCsv(
      ['firstName', 'lastName', 'email', 'admissionNo', 'rollNo', 'department', 'batch', 'status'],
      rows.map((s) => [
        s.user.firstName,
        s.user.lastName,
        s.user.email,
        s.admissionNo,
        s.rollNo,
        s.department.name,
        s.batch,
        s.status,
      ]),
    );
    await this.logExport(user, 'students', rows.length);
    return csv;
  }

  async attendance(
    user: AuthenticatedUser,
    query: z.infer<typeof attendanceQuery>,
  ): Promise<string> {
    await this.assertAllScope(user, 'attendance.read');
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        session: {
          section: {
            collegeId: user.collegeId, // tenancy — foreign sectionIds go empty
            ...(query.sectionId ? { id: query.sectionId } : {}),
          },
          ...(query.from || query.to
            ? {
                date: {
                  ...(query.from ? { gte: new Date(query.from) } : {}),
                  ...(query.to ? { lte: new Date(query.to) } : {}),
                },
              }
            : {}),
        },
      },
      include: {
        session: {
          select: {
            date: true,
            section: {
              select: {
                name: true,
                course: { select: { code: true } },
              },
            },
          },
        },
        student: {
          select: {
            rollNo: true,
            admissionNo: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: [{ session: { date: 'asc' } }],
      // F1: cap materialization memory, not just the response.
      take: CSV_ROW_CAP + 1,
    });
    const csv = toCsv(
      ['date', 'course', 'section', 'rollNo', 'admissionNo', 'student', 'status'],
      records.map((r) => [
        r.session.date.toISOString().slice(0, 10),
        r.session.section.course.code,
        r.session.section.name,
        r.student.rollNo,
        r.student.admissionNo,
        `${r.student.user.firstName} ${r.student.user.lastName}`,
        r.status,
      ]),
    );
    await this.logExport(user, 'attendance', records.length);
    return csv;
  }

  async fees(
    user: AuthenticatedUser,
    query: z.infer<typeof feesQuery>,
  ): Promise<string> {
    await this.assertAllScope(user, 'fees.read');
    const invoices = await this.prisma.invoice.findMany({
      where: {
        collegeId: user.collegeId,
        ...(query.status ? { status: query.status } : {}),
        // M23-W3 (D-1): `termId` was spread straight onto Invoice, which
        // has no such column, so any ?termId= request died with a 500.
        // An invoice's term is reached through its REQUIRED FeeStructure
        // (`Invoice.structureId` is non-null and `FeeStructure.termId` is
        // the only term relationship in the finance schema), so the
        // filter is relational rather than a new denormalized column.
        // Tenancy is unaffected: the top-level server-derived collegeId
        // still bounds the query, so a rival-college termId simply
        // matches nothing instead of leaking another tenant's invoices.
        ...(query.termId ? { structure: { termId: query.termId } } : {}),
      },
      include: {
        student: {
          select: {
            rollNo: true,
            admissionNo: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
        payments: { select: { amount: true } },
        // M16-W5: exported "paid" is NET of settled refunds (D-5), matching
        // every other money surface since M16-W2.
        refunds: { select: { amount: true } },
      },
      orderBy: { createdAt: 'asc' },
      // F1: cap materialization memory, not just the response.
      take: CSV_ROW_CAP + 1,
    });
    const csv = toCsv(
      ['invoiceNo', 'student', 'rollNo', 'admissionNo', 'amount', 'paid', 'status', 'dueDate'],
      invoices.map((invoice) => [
        invoice.invoiceNo,
        `${invoice.student.user.firstName} ${invoice.student.user.lastName}`,
        invoice.student.rollNo,
        invoice.student.admissionNo,
        invoice.amount.toString(),
        netPaid(invoice).toString(),
        invoice.status,
        invoice.dueDate.toISOString().slice(0, 10),
      ]),
    );
    await this.logExport(user, 'fees', invoices.length);
    return csv;
  }

  async results(
    user: AuthenticatedUser,
    query: z.infer<typeof resultsQuery>,
  ): Promise<string> {
    await this.assertAllScope(user, 'results.read');
    const marks = await this.prisma.mark.findMany({
      where: {
        examPaper: {
          exam: { id: query.examId, collegeId: user.collegeId }, // tenancy
        },
      },
      include: {
        examPaper: {
          select: {
            maxMarks: true,
            section: {
              select: { name: true, course: { select: { code: true } } },
            },
            exam: { select: { title: true } },
          },
        },
        student: {
          select: {
            rollNo: true,
            admissionNo: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: [{ student: { rollNo: 'asc' } }],
      // F1: cap materialization memory, not just the response.
      take: CSV_ROW_CAP + 1,
    });
    const csv = toCsv(
      ['exam', 'course', 'section', 'rollNo', 'admissionNo', 'student', 'marksObtained', 'maxMarks'],
      marks.map((m) => [
        m.examPaper.exam.title,
        m.examPaper.section.course.code,
        m.examPaper.section.name,
        m.student.rollNo,
        m.student.admissionNo,
        `${m.student.user.firstName} ${m.student.user.lastName}`,
        m.marksObtained.toString(),
        m.examPaper.maxMarks.toString(),
      ]),
    );
    await this.logExport(user, 'results', marks.length);
    return csv;
  }

  /**
   * M16-W5 — refund attempts export (finance surface). Gated exactly like
   * the reconciliation view: fees.manage resolved to ALL (ADMIN and
   * ACCOUNTANT). Tenant-scoped by the session collegeId; ids/amounts/
   * refs/reason only — no student PII beyond the existing finance-export
   * policy (invoice number identifies the account).
   */
  async refunds(
    user: AuthenticatedUser,
    query: z.infer<typeof refundsQuery>,
  ): Promise<string> {
    await this.assertAllScope(user, 'fees.manage');
    const rows = await this.prisma.refundAttempt.findMany({
      where: {
        collegeId: user.collegeId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.method ? { method: query.method } : {}),
      },
      include: {
        invoice: { select: { invoiceNo: true } },
        requestedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: CSV_ROW_CAP + 1,
    });
    const csv = toCsv(
      [
        'attemptId',
        'refundId',
        'invoiceNo',
        'paymentId',
        'amount',
        'currency',
        'method',
        'status',
        'reason',
        'providerRefundRef',
        'failureCode',
        'requestedBy',
        'createdAt',
        'confirmedAt',
      ],
      rows.map((row) => [
        row.id,
        row.refundId,
        row.invoice.invoiceNo,
        row.paymentId,
        Number(row.amount).toFixed(2),
        row.currency,
        row.method,
        row.status,
        row.reason,
        row.providerRefundRef,
        row.failureCode,
        `${row.requestedBy.firstName} ${row.requestedBy.lastName}`,
        row.createdAt.toISOString(),
        row.confirmedAt?.toISOString() ?? null,
      ]),
    );
    await this.logExport(user, 'refunds', rows.length);
    return csv;
  }
}

function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

function handle(res: Response, filename: string) {
  return (csv: string) => sendCsv(res, filename, csv);
}

@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get('students.csv')
  async students(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(studentsQuery)) query: z.infer<typeof studentsQuery>,
    @Res() res: Response,
  ): Promise<void> {
    await this.run(res, 'students.csv', () => this.exports.students(user, query));
  }

  @Get('attendance.csv')
  async attendance(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(attendanceQuery)) query: z.infer<typeof attendanceQuery>,
    @Res() res: Response,
  ): Promise<void> {
    await this.run(res, 'attendance.csv', () => this.exports.attendance(user, query));
  }

  @Get('fees.csv')
  async fees(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(feesQuery)) query: z.infer<typeof feesQuery>,
    @Res() res: Response,
  ): Promise<void> {
    await this.run(res, 'fees.csv', () => this.exports.fees(user, query));
  }

  @Get('results.csv')
  async results(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(resultsQuery)) query: z.infer<typeof resultsQuery>,
    @Res() res: Response,
  ): Promise<void> {
    await this.run(res, 'results.csv', () => this.exports.results(user, query));
  }

  @Get('refunds.csv')
  async refunds(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(refundsQuery)) query: z.infer<typeof refundsQuery>,
    @Res() res: Response,
  ): Promise<void> {
    await this.run(res, 'refunds.csv', () => this.exports.refunds(user, query));
  }

  /** CSV responses bypass the JSON envelope; errors keep the envelope. */
  private async run(
    res: Response,
    filename: string,
    produce: () => Promise<string>,
  ): Promise<void> {
    try {
      handle(res, filename)(await produce());
    } catch (error) {
      if (error instanceof CsvTooLargeError) {
        throw new HttpException(
          {
            code: 'EXPORT_TOO_LARGE',
            message: 'Export exceeds the row limit; narrow the filters.',
          },
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      }
      throw error;
    }
  }
}

@Module({
  controllers: [ExportsController],
  providers: [ExportsService],
})
export class ExportsModule {}
