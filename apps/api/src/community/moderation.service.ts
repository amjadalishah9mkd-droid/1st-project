import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateReportInput,
  ModerationActionInput,
  PageMeta,
  PaginationQuery,
  RenderedTarget,
  ReportDetail,
  ReportItem,
  ResolveReportInput,
} from '@campusos/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../access/policy.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.module';
import type { AuthenticatedUser } from '../access/authenticated-user';
import { pageArgs, pageMeta } from '../common/pagination/pagination';

const reportInclude = {
  reporter: { select: { firstName: true, lastName: true } },
  resolvedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ReportInclude;

type ReportRecord = Prisma.ReportGetPayload<{ include: typeof reportInclude }>;

@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  private toItem(row: ReportRecord, countForTarget: number): ReportItem {
    return {
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      reason: row.reason,
      details: row.details,
      status: row.status,
      reporterName: `${row.reporter.firstName} ${row.reporter.lastName}`,
      createdAt: row.createdAt.toISOString(),
      resolvedByName: row.resolvedBy
        ? `${row.resolvedBy.firstName} ${row.resolvedBy.lastName}`
        : null,
      resolutionNote: row.resolutionNote,
      reportCountForTarget: countForTarget,
    };
  }

  // ── Reporting (any participant) ─────────────────────────────

  async createReport(
    user: AuthenticatedUser,
    input: CreateReportInput,
  ): Promise<ReportItem> {
    const target = await this.renderTarget(
      user.collegeId,
      input.targetType,
      input.targetId,
    );
    if (!target) {
      throw new BadRequestException({
        code: 'INVALID_TARGET',
        message: 'The reported content does not exist',
      });
    }
    const duplicate = await this.prisma.report.findFirst({
      where: {
        collegeId: user.collegeId,
        reporterId: user.id,
        targetType: input.targetType,
        targetId: input.targetId,
        status: { in: ['OPEN', 'REVIEWING'] },
      },
    });
    if (duplicate) {
      throw new BadRequestException({
        code: 'ALREADY_REPORTED',
        message: 'You already reported this content',
      });
    }
    const created = await this.prisma.report.create({
      data: {
        collegeId: user.collegeId,
        reporterId: user.id,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        details: input.details,
      },
      include: reportInclude,
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'moderation.report_filed',
      targetType: input.targetType,
      targetId: input.targetId,
    });
    const count = await this.prisma.report.count({
      where: {
        collegeId: user.collegeId,
        targetType: input.targetType,
        targetId: input.targetId,
      },
    });
    return this.toItem(created, count);
  }

  // ── Queue (moderation.act) ──────────────────────────────────

  async listReports(
    user: AuthenticatedUser,
    query: PaginationQuery & { status?: string },
  ): Promise<{ data: ReportItem[]; meta: PageMeta }> {
    const where: Prisma.ReportWhereInput = {
      collegeId: user.collegeId,
      ...(query.status ? { status: query.status as never } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.report.findMany({
        where,
        include: reportInclude,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(query),
      }),
      this.prisma.report.count({ where }),
    ]);
    const counts = await this.prisma.report.groupBy({
      by: ['targetType', 'targetId'],
      where: { collegeId: user.collegeId },
      _count: true,
    });
    const countMap = new Map(
      counts.map((c) => [`${c.targetType}:${c.targetId}`, c._count]),
    );
    return {
      data: rows.map((row) =>
        this.toItem(row, countMap.get(`${row.targetType}:${row.targetId}`) ?? 1),
      ),
      meta: pageMeta(query, total),
    };
  }

  async reportDetail(user: AuthenticatedUser, id: string): Promise<ReportDetail> {
    const row = await this.prisma.report.findFirst({
      where: { id, collegeId: user.collegeId },
      include: reportInclude,
    });
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Report not found' });
    }
    const target = await this.renderTarget(
      user.collegeId,
      row.targetType,
      row.targetId,
    );
    const count = await this.prisma.report.count({
      where: {
        collegeId: user.collegeId,
        targetType: row.targetType,
        targetId: row.targetId,
      },
    });
    const targetUserSuspended = target?.authorUserId
      ? await this.isSuspended(target.authorUserId)
      : false;
    return { ...this.toItem(row, count), target, targetUserSuspended };
  }

  async resolveReport(
    user: AuthenticatedUser,
    id: string,
    input: ResolveReportInput,
  ): Promise<ReportDetail> {
    const row = await this.prisma.report.findFirst({
      where: { id, collegeId: user.collegeId },
    });
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Report not found' });
    }
    await this.prisma.report.update({
      where: { id },
      data: {
        status: input.status,
        resolutionNote: input.resolutionNote,
        ...(input.status === 'RESOLVED' || input.status === 'DISMISSED'
          ? { resolvedById: user.id, resolvedAt: new Date() }
          : {}),
      },
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: `moderation.report_${input.status.toLowerCase()}`,
      targetType: 'Report',
      targetId: id,
    });
    return this.reportDetail(user, id);
  }

  // ── Actions ─────────────────────────────────────────────────

  async act(
    user: AuthenticatedUser,
    input: ModerationActionInput,
  ): Promise<ReportDetail | { done: true }> {
    const target = await this.renderTarget(
      user.collegeId,
      input.targetType,
      input.targetId,
    );
    if (!target && input.targetType !== 'USER') {
      throw new BadRequestException({
        code: 'INVALID_TARGET',
        message: 'The target content does not exist',
      });
    }
    const targetUserId =
      input.targetUserId ?? target?.authorUserId ?? null;

    // Admin immunity (Blueprint §11): users whose role holds moderation.act
    // cannot be suspended or warned into lockout.
    if (
      ['SUSPEND_COMMUNITY', 'WARN_USER'].includes(input.action) &&
      targetUserId
    ) {
      const targetUser = await this.prisma.user.findFirst({
        where: { id: targetUserId, collegeId: user.collegeId },
      });
      if (!targetUser) {
        throw new BadRequestException({
          code: 'INVALID_USER',
          message: 'Target user not found in this college',
        });
      }
      const grants = await this.policy.grantsForRole(targetUser.role);
      if (
        input.action === 'SUSPEND_COMMUNITY' &&
        grants.some((grant) => grant.key === 'moderation.act')
      ) {
        throw new BadRequestException({
          code: 'TARGET_IMMUNE',
          message: 'Users with moderation rights cannot be suspended',
        });
      }
    }

    switch (input.action) {
      case 'REMOVE_CONTENT':
        await this.setContentStatus(user, input.targetType, input.targetId, false);
        break;
      case 'RESTORE_CONTENT':
        await this.setContentStatus(user, input.targetType, input.targetId, true);
        break;
      case 'WARN_USER':
      case 'SUSPEND_COMMUNITY':
      case 'LIFT_SUSPENSION':
        if (!targetUserId) {
          throw new BadRequestException({
            code: 'MISSING_TARGET_USER',
            message: 'This action needs a target user',
          });
        }
        break;
    }

    const expiresAt =
      input.action === 'SUSPEND_COMMUNITY' && input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86400000)
        : null;

    const action = await this.prisma.moderationAction.create({
      data: {
        collegeId: user.collegeId,
        reportId: input.reportId,
        actorId: user.id,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        targetUserId,
        expiresAt,
        note: input.note,
      },
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: `moderation.${input.action.toLowerCase()}`,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: { moderationActionId: action.id },
    });

    if (targetUserId && targetUserId !== user.id) {
      this.events.emit({
        type: 'moderation.action_taken',
        action: input.action,
        targetUserId,
        note: input.note ?? null,
      });
    }

    // Acting on a report resolves it.
    if (input.reportId) {
      await this.prisma.report.updateMany({
        where: { id: input.reportId, collegeId: user.collegeId },
        data: {
          status: 'RESOLVED',
          resolvedById: user.id,
          resolvedAt: new Date(),
          resolutionNote: input.note,
        },
      });
      return this.reportDetail(user, input.reportId);
    }
    return { done: true };
  }

  // ── helpers ─────────────────────────────────────────────────

  private async isSuspended(userId: string): Promise<boolean> {
    const suspension = await this.prisma.moderationAction.findFirst({
      where: {
        targetUserId: userId,
        action: 'SUSPEND_COMMUNITY',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!suspension) return false;
    const lifted = await this.prisma.moderationAction.findFirst({
      where: {
        targetUserId: userId,
        action: 'LIFT_SUSPENSION',
        createdAt: { gt: suspension.createdAt },
      },
    });
    return lifted === null;
  }

  private async setContentStatus(
    user: AuthenticatedUser,
    targetType: string,
    targetId: string,
    restore: boolean,
  ): Promise<void> {
    if (targetType === 'POST') {
      await this.prisma.post.updateMany({
        where: { id: targetId, collegeId: user.collegeId },
        data: { status: restore ? 'ACTIVE' : 'REMOVED_BY_MODERATOR' },
      });
    } else if (targetType === 'COMMENT') {
      const comment = await this.prisma.comment.findFirst({
        where: { id: targetId, post: { collegeId: user.collegeId } },
      });
      if (!comment) return;
      const wasActive = comment.status === 'ACTIVE';
      await this.prisma.$transaction([
        this.prisma.comment.update({
          where: { id: targetId },
          data: { status: restore ? 'ACTIVE' : 'REMOVED_BY_MODERATOR' },
        }),
        // Keep the counter truthful (Blueprint §11).
        ...(restore && !wasActive
          ? [
              this.prisma.post.update({
                where: { id: comment.postId },
                data: { commentCount: { increment: 1 } },
              }),
            ]
          : !restore && wasActive
            ? [
                this.prisma.post.update({
                  where: { id: comment.postId },
                  data: { commentCount: { decrement: 1 } },
                }),
              ]
            : []),
      ]);
    } else if (targetType === 'EVENT') {
      await this.prisma.event.updateMany({
        where: { id: targetId, collegeId: user.collegeId },
        data: { status: restore ? 'ACTIVE' : 'REMOVED' },
      });
    } else if (targetType === 'RESOURCE') {
      await this.prisma.resource.updateMany({
        where: { id: targetId, collegeId: user.collegeId },
        data: { status: restore ? 'ACTIVE' : 'REMOVED_BY_MODERATOR' },
      });
    } else {
      throw new BadRequestException({
        code: 'INVALID_ACTION',
        message: 'Content actions do not apply to user targets',
      });
    }
  }

  private async renderTarget(
    collegeId: string,
    targetType: string,
    targetId: string,
  ): Promise<RenderedTarget | null> {
    if (targetType === 'POST') {
      const post = await this.prisma.post.findFirst({
        where: { id: targetId, collegeId },
        include: { author: { select: { id: true, firstName: true, lastName: true } } },
      });
      if (!post) return null;
      return {
        kind: 'POST',
        title: 'Post',
        body: post.body,
        authorUserId: post.author.id,
        authorName: `${post.author.firstName} ${post.author.lastName}`,
        status: post.status,
      };
    }
    if (targetType === 'COMMENT') {
      const comment = await this.prisma.comment.findFirst({
        where: { id: targetId, post: { collegeId } },
        include: { author: { select: { id: true, firstName: true, lastName: true } } },
      });
      if (!comment) return null;
      return {
        kind: 'COMMENT',
        title: 'Comment',
        body: comment.body,
        authorUserId: comment.author.id,
        authorName: `${comment.author.firstName} ${comment.author.lastName}`,
        status: comment.status,
      };
    }
    if (targetType === 'EVENT') {
      const event = await this.prisma.event.findFirst({
        where: { id: targetId, collegeId },
        include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
      });
      if (!event) return null;
      return {
        kind: 'EVENT',
        title: event.title,
        body: event.description,
        authorUserId: event.createdBy.id,
        authorName: `${event.createdBy.firstName} ${event.createdBy.lastName}`,
        status: event.status,
      };
    }
    if (targetType === 'RESOURCE') {
      const resource = await this.prisma.resource.findFirst({
        where: { id: targetId, collegeId },
        include: { uploader: { select: { id: true, firstName: true, lastName: true } } },
      });
      if (!resource) return null;
      return {
        kind: 'RESOURCE',
        title: resource.title,
        body: resource.description,
        authorUserId: resource.uploader.id,
        authorName: `${resource.uploader.firstName} ${resource.uploader.lastName}`,
        status: resource.status,
      };
    }
    if (targetType === 'USER') {
      const target = await this.prisma.user.findFirst({
        where: { id: targetId, collegeId },
      });
      if (!target) return null;
      return {
        kind: 'USER',
        title: `${target.firstName} ${target.lastName}`,
        body: null,
        authorUserId: target.id,
        authorName: `${target.firstName} ${target.lastName}`,
        status: target.status,
      };
    }
    return null;
  }
}
