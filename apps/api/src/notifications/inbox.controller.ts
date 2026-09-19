import { Injectable } from '@nestjs/common';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  notificationsQuerySchema,
  paginationQuerySchema,
  type NotificationItem,
  type PageMeta,
  type PaginationQuery,
} from '@campusos/shared';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';
import { pageArgs, pageMeta } from '../common/pagination/pagination';

/**
 * Notification inbox (Blueprint §7/§10 — M8).
 * Strictly self-scoped: every query filters by the caller's userId; there is
 * no way to address another user's notifications.
 */
@Injectable()
export class InboxService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    user: AuthenticatedUser,
    query: PaginationQuery & { unread?: string },
  ): Promise<{ data: NotificationItem[]; meta: PageMeta }> {
    const where = {
      userId: user.id,
      ...(query.unread === 'true' ? { readAt: null } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(query),
      }),
      this.prisma.notification.count({ where }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        linkPath: row.linkPath,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      meta: pageMeta(query, total),
    };
  }

  async unreadCount(user: AuthenticatedUser): Promise<{ unread: number }> {
    const unread = await this.prisma.notification.count({
      where: { userId: user.id, readAt: null },
    });
    return { unread };
  }

  async markRead(user: AuthenticatedUser, id: string): Promise<{ read: true }> {
    await this.prisma.notification.updateMany({
      where: { id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { read: true };
  }

  async markAllRead(user: AuthenticatedUser): Promise<{ read: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { read: result.count };
  }
}

const listSchema = paginationQuerySchema.merge(notificationsQuerySchema);

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>,
  ) {
    return this.inbox.list(user, query);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.inbox.unreadCount(user);
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.inbox.markRead(user, id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.inbox.markAllRead(user);
  }
}
