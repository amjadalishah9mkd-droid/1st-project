import { BadRequestException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  studentImportRowSchema,
  type StudentImportSummary,
} from '@campusos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../access/authenticated-user';
import { generateTempPassword } from './students.service';

/**
 * CSV student import (Blueprint §7 / M2-E).
 * Header: firstName,lastName,email,admissionNo,rollNo,batch,departmentCode
 * Every row is validated independently; invalid rows are reported and never
 * partially created. Valid rows are created atomically (User+StudentProfile
 * in one nested write) with argon2id-hashed generated passwords and
 * mustChangePassword=true.
 */
@Injectable()
export class StudentsImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async import(
    user: AuthenticatedUser,
    csvText: string,
  ): Promise<StudentImportSummary> {
    const rows = parseCsv(csvText);
    if (rows.length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_CSV',
        message: 'The CSV file contains no data rows',
      });
    }

    const header = rows[0].map((cell) => cell.trim());
    const expected = [
      'firstName',
      'lastName',
      'email',
      'admissionNo',
      'rollNo',
      'batch',
      'departmentCode',
    ];
    if (expected.some((column, index) => header[index] !== column)) {
      throw new BadRequestException({
        code: 'INVALID_CSV_HEADER',
        message: `CSV header must be exactly: ${expected.join(',')}`,
      });
    }

    const departments = await this.prisma.department.findMany({
      where: { collegeId: user.collegeId },
      select: { id: true, code: true },
    });
    const departmentByCode = new Map(departments.map((d) => [d.code, d.id]));

    const summary: StudentImportSummary = {
      created: 0,
      failed: 0,
      errors: [],
      createdStudents: [],
    };
    const seenEmails = new Set<string>();
    const seenAdmissionNos = new Set<string>();

    for (let index = 1; index < rows.length; index += 1) {
      const rowNumber = index + 1; // 1-based, header = row 1
      const cells = rows[index];
      if (cells.length === 1 && cells[0].trim() === '') continue;

      const candidate = {
        firstName: cells[0]?.trim(),
        lastName: cells[1]?.trim(),
        email: cells[2]?.trim(),
        admissionNo: cells[3]?.trim(),
        rollNo: cells[4]?.trim(),
        batch: cells[5]?.trim(),
        departmentCode: cells[6]?.trim(),
      };

      const parsed = studentImportRowSchema.safeParse(candidate);
      if (!parsed.success) {
        summary.failed += 1;
        summary.errors.push({
          row: rowNumber,
          message: parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
        });
        continue;
      }
      const row = parsed.data;

      if (seenEmails.has(row.email) || seenAdmissionNos.has(row.admissionNo)) {
        summary.failed += 1;
        summary.errors.push({
          row: rowNumber,
          message: 'Duplicate email or admission number within the file',
        });
        continue;
      }

      const departmentId = departmentByCode.get(row.departmentCode.toUpperCase());
      if (!departmentId) {
        summary.failed += 1;
        summary.errors.push({
          row: rowNumber,
          message: `Unknown department code "${row.departmentCode}"`,
        });
        continue;
      }

      const [emailTaken, admissionTaken] = await Promise.all([
        this.prisma.user.findFirst({
          where: { collegeId: user.collegeId, email: row.email },
          select: { id: true },
        }),
        this.prisma.studentProfile.findFirst({
          where: { collegeId: user.collegeId, admissionNo: row.admissionNo },
          select: { id: true },
        }),
      ]);
      if (emailTaken) {
        summary.failed += 1;
        summary.errors.push({
          row: rowNumber,
          message: `Email ${row.email} already exists`,
        });
        continue;
      }
      if (admissionTaken) {
        summary.failed += 1;
        summary.errors.push({
          row: rowNumber,
          message: `Admission number ${row.admissionNo} already exists`,
        });
        continue;
      }

      const tempPassword = generateTempPassword();
      const passwordHash = await argon2.hash(tempPassword, {
        type: argon2.argon2id,
      });

      await this.prisma.studentProfile.create({
        data: {
          college: { connect: { id: user.collegeId } },
          department: { connect: { id: departmentId } },
          admissionNo: row.admissionNo,
          rollNo: row.rollNo,
          batch: row.batch,
          user: {
            create: {
              college: { connect: { id: user.collegeId } },
              email: row.email,
              passwordHash,
              role: 'STUDENT',
              firstName: row.firstName,
              lastName: row.lastName,
              mustChangePassword: true,
            },
          },
        },
      });

      seenEmails.add(row.email);
      seenAdmissionNos.add(row.admissionNo);
      summary.created += 1;
      summary.createdStudents.push({
        row: rowNumber,
        email: row.email,
        admissionNo: row.admissionNo,
        tempPassword,
      });
    }

    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'students.imported',
      metadata: { created: summary.created, failed: summary.failed },
    });
    return summary;
  }
}

/** Minimal CSV parser with quoted-field support. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}
