import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AcademicYearItem,
  CreateAcademicYearInput,
  CreateTermInput,
  PageMeta,
  PaginationQuery,
  TermItem,
  UpdateAcademicYearInput,
  UpdateTermInput,
} from '@campusos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TermLifecycleService } from './term-lifecycle.service';
import { AuditService } from '../audit/audit.service';
import { changedFields } from '../audit/changed-fields';
import type { AuthenticatedUser } from '../access/authenticated-user';
import { pageArgs, pageMeta } from '../common/pagination/pagination';

/** Academic years + terms (calendar). One current term per college. */
@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: TermLifecycleService,
    private readonly audit: AuditService,
  ) {}

  // ── Academic years ─────────────────────────────────────────

  async listYears(
    user: AuthenticatedUser,
    query: PaginationQuery,
  ): Promise<{ data: AcademicYearItem[]; meta: PageMeta }> {
    const where = { collegeId: user.collegeId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.academicYear.findMany({
        where,
        include: { _count: { select: { terms: true } } },
        orderBy: { startsOn: 'desc' },
        ...pageArgs(query),
      }),
      this.prisma.academicYear.count({ where }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        label: row.label,
        startsOn: row.startsOn.toISOString().slice(0, 10),
        endsOn: row.endsOn.toISOString().slice(0, 10),
        termCount: row._count.terms,
      })),
      meta: pageMeta(query, total),
    };
  }

  async createYear(
    user: AuthenticatedUser,
    input: CreateAcademicYearInput,
  ): Promise<AcademicYearItem> {
    const duplicate = await this.prisma.academicYear.findFirst({
      where: { collegeId: user.collegeId, label: input.label },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException({
        code: 'DUPLICATE_YEAR_LABEL',
        message: `Academic year "${input.label}" already exists`,
      });
    }
    const created = await this.prisma.academicYear.create({
      data: {
        collegeId: user.collegeId,
        label: input.label,
        startsOn: new Date(input.startsOn),
        endsOn: new Date(input.endsOn),
      },
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'academic_years.created',
      targetType: 'AcademicYear',
      targetId: created.id,
    });
    return {
      id: created.id,
      label: created.label,
      startsOn: created.startsOn.toISOString().slice(0, 10),
      endsOn: created.endsOn.toISOString().slice(0, 10),
      termCount: 0,
    };
  }

  async updateYear(
    user: AuthenticatedUser,
    id: string,
    input: UpdateAcademicYearInput,
  ): Promise<AcademicYearItem> {
    const existing = await this.prisma.academicYear.findFirst({
      where: { id, collegeId: user.collegeId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Academic year not found',
      });
    }
    const startsOn = input.startsOn ? new Date(input.startsOn) : existing.startsOn;
    const endsOn = input.endsOn ? new Date(input.endsOn) : existing.endsOn;
    if (startsOn.getTime() >= endsOn.getTime()) {
      throw new BadRequestException({
        code: 'INVALID_DATES',
        message: 'End date must be after the start date',
      });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.academicYear.update({
        where: { id },
        data: { label: input.label, startsOn, endsOn },
        include: { _count: { select: { terms: true } } },
      });
      // M23-W2 (S-2): academic_years.created was audited, updates were
      // not. Calendar boundaries gate term lifecycle, so record them.
      await this.audit.logAtomic(
        {
          collegeId: user.collegeId,
          actorId: user.id,
          action: 'academic_years.updated',
          targetType: 'AcademicYear',
          targetId: id,
          metadata: {
            changed: changedFields(['label', 'startsOn', 'endsOn'], existing, {
              label: input.label,
              startsOn: input.startsOn ? startsOn : undefined,
              endsOn: input.endsOn ? endsOn : undefined,
            }),
          },
        },
        tx,
      );
      return row;
    });
    return {
      id: updated.id,
      label: updated.label,
      startsOn: updated.startsOn.toISOString().slice(0, 10),
      endsOn: updated.endsOn.toISOString().slice(0, 10),
      termCount: updated._count.terms,
    };
  }

  // ── Terms ──────────────────────────────────────────────────

  private toTermItem(row: {
    id: string;
    academicYearId: string;
    academicYear: { label: string };
    label: string;
    startsOn: Date;
    endsOn: Date;
    isCurrent: boolean;
    status: 'ACTIVE' | 'CLOSED';
    _count: { sections: number };
  }): TermItem {
    return {
      id: row.id,
      academicYearId: row.academicYearId,
      academicYearLabel: row.academicYear.label,
      label: row.label,
      startsOn: row.startsOn.toISOString().slice(0, 10),
      endsOn: row.endsOn.toISOString().slice(0, 10),
      isCurrent: row.isCurrent,
      status: row.status,
      sectionCount: row._count.sections,
    };
  }

  async listTerms(
    user: AuthenticatedUser,
    query: PaginationQuery,
  ): Promise<{ data: TermItem[]; meta: PageMeta }> {
    const where = { collegeId: user.collegeId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.term.findMany({
        where,
        include: {
          academicYear: { select: { label: true } },
          _count: { select: { sections: true } },
        },
        orderBy: [{ startsOn: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.term.count({ where }),
    ]);
    return {
      data: rows.map((row) => this.toTermItem(row)),
      meta: pageMeta(query, total),
    };
  }

  async createTerm(
    user: AuthenticatedUser,
    input: CreateTermInput,
  ): Promise<TermItem> {
    const year = await this.prisma.academicYear.findFirst({
      where: { id: input.academicYearId, collegeId: user.collegeId },
      select: { id: true },
    });
    if (!year) {
      throw new BadRequestException({
        code: 'INVALID_ACADEMIC_YEAR',
        message: 'The selected academic year does not exist in this college',
      });
    }
    const duplicate = await this.prisma.term.findFirst({
      where: { academicYearId: input.academicYearId, label: input.label },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException({
        code: 'DUPLICATE_TERM_LABEL',
        message: `Term "${input.label}" already exists in this academic year`,
      });
    }
    const created = await this.prisma.term.create({
      data: {
        collegeId: user.collegeId,
        academicYearId: input.academicYearId,
        label: input.label,
        startsOn: new Date(input.startsOn),
        endsOn: new Date(input.endsOn),
      },
      include: {
        academicYear: { select: { label: true } },
        _count: { select: { sections: true } },
      },
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'terms.created',
      targetType: 'Term',
      targetId: created.id,
    });
    return this.toTermItem(created);
  }

  async updateTerm(
    user: AuthenticatedUser,
    id: string,
    input: UpdateTermInput,
  ): Promise<TermItem> {
    const existing = await this.prisma.term.findFirst({
      where: { id, collegeId: user.collegeId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Term not found',
      });
    }
    // M17-W4: routed through the ONE shared guard (FOR SHARE on the Term
    // row) instead of an inline status check — consistent lock semantics
    // with every other CLOSED-term enforcement point.
    await this.lifecycle.assertTermOpen(this.prisma, user.collegeId, id);
    const startsOn = input.startsOn ? new Date(input.startsOn) : existing.startsOn;
    const endsOn = input.endsOn ? new Date(input.endsOn) : existing.endsOn;
    if (startsOn.getTime() >= endsOn.getTime()) {
      throw new BadRequestException({
        code: 'INVALID_DATES',
        message: 'End date must be after the start date',
      });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.term.update({
        where: { id },
        data: { label: input.label, startsOn, endsOn },
        include: {
          academicYear: { select: { label: true } },
          _count: { select: { sections: true } },
        },
      });
      // M23-W2 (S-2): term boundaries drive CLOSED-term enforcement,
      // invoice eligibility and rollover, so edits are now recorded.
      await this.audit.logAtomic(
        {
          collegeId: user.collegeId,
          actorId: user.id,
          action: 'terms.updated',
          targetType: 'Term',
          targetId: id,
          metadata: {
            academicYearId: existing.academicYearId,
            changed: changedFields(['label', 'startsOn', 'endsOn'], existing, {
              label: input.label,
              startsOn: input.startsOn ? startsOn : undefined,
              endsOn: input.endsOn ? endsOn : undefined,
            }),
          },
        },
        tx,
      );
      return row;
    });
    return this.toTermItem(updated);
  }

  /** Atomically makes this the single current term for the college. */
  async setCurrentTerm(user: AuthenticatedUser, id: string): Promise<TermItem> {
    const existing = await this.prisma.term.findFirst({
      where: { id, collegeId: user.collegeId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Term not found',
      });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      // M17-W1: row-lock the target so set-current serializes against a
      // concurrent close (design §17), then re-check lifecycle state —
      // a CLOSED term can never become current (D-3 corollary).
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT "status" FROM "Term" WHERE id = ${id} FOR UPDATE`;
      if (locked.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Term not found' });
      }
      if (locked[0].status === 'CLOSED') {
        throw new ConflictException({
          code: 'TERM_CLOSED',
          message: 'A closed term cannot be made current — reopen it first',
        });
      }
      await tx.term.updateMany({
        where: { collegeId: user.collegeId, isCurrent: true },
        data: { isCurrent: false },
      });
      return tx.term.update({
        where: { id },
        data: { isCurrent: true },
        include: {
          academicYear: { select: { label: true } },
          _count: { select: { sections: true } },
        },
      });
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'terms.set_current',
      targetType: 'Term',
      targetId: id,
    });
    return this.toTermItem(updated);
  }
}
