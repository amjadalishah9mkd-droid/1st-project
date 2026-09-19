import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CommentItem,
  CreateCommentInput,
  CreatePostInput,
  PageMeta,
  PaginationQuery,
  PostItem,
  UpdatePostInput,
} from '@campusos/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../access/policy.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.module';
import { CommunityAccessPolicy } from './community-access.policy';
import type { AuthenticatedUser } from '../access/authenticated-user';
import { pageArgs, pageMeta } from '../common/pagination/pagination';

function forbidden(): ForbiddenException {
  return new ForbiddenException({
    code: 'FORBIDDEN',
    message: 'You do not have permission to perform this action',
  });
}

const postInclude = {
  author: { select: { id: true, firstName: true, lastName: true, role: true } },
  group: { select: { id: true, name: true } },
  society: { select: { id: true, name: true } },
  resource: { select: { id: true, title: true, fileUrl: true } },
  event: { select: { id: true, title: true, startsAt: true } },
} satisfies Prisma.PostInclude;

type PostRecord = Prisma.PostGetPayload<{ include: typeof postInclude }>;

@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly access: CommunityAccessPolicy,
  ) {}

  /** True when the user moderates the group the post lives in. */
  private async isGroupModerator(
    userId: string,
    groupId: string | null,
  ): Promise<boolean> {
    if (!groupId) return false;
    const membership = await this.prisma.groupMember.findFirst({
      where: { groupId, userId, role: 'MODERATOR', status: 'ACTIVE' },
      select: { id: true },
    });
    return membership !== null;
  }

  private async toItem(
    row: PostRecord,
    user: AuthenticatedUser,
    likedSet?: Set<string>,
  ): Promise<PostItem> {
    const likedByMe =
      likedSet?.has(row.id) ??
      (await this.prisma.like.findFirst({
        where: { postId: row.id, userId: user.id },
        select: { id: true },
      })) !== null;
    const canModerate =
      row.authorId === user.id ||
      (await this.isGroupModerator(user.id, row.groupId));
    return {
      id: row.id,
      type: row.type,
      body:
        row.status === 'ACTIVE'
          ? row.body
          : row.status === 'REMOVED_BY_AUTHOR'
            ? '[removed by the author]'
            : '[removed by moderation]',
      author: {
        id: row.author.id,
        name: `${row.author.firstName} ${row.author.lastName}`,
        role: row.author.role,
      },
      groupId: row.group?.id ?? null,
      groupName: row.group?.name ?? null,
      societyId: row.society?.id ?? null,
      societyName: row.society?.name ?? null,
      resource: row.resource,
      event: row.event
        ? { ...row.event, startsAt: row.event.startsAt.toISOString() }
        : null,
      likeCount: row.likeCount,
      commentCount: row.commentCount,
      likedByMe,
      canDelete: row.status === 'ACTIVE' && canModerate,
      canEdit: row.status === 'ACTIVE' && row.authorId === user.id,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Feed scoping (Blueprint §11):
   *  - default: campus feed (no group/society)
   *  - groupId: OPEN groups visible to all; REQUEST groups members-only
   *  - societyId: society walls are public within the college
   */
  async list(
    user: AuthenticatedUser,
    query: PaginationQuery & { groupId?: string; societyId?: string },
  ): Promise<{ data: PostItem[]; meta: PageMeta }> {
    if (query.groupId) {
      const group = await this.prisma.group.findFirst({
        where: { id: query.groupId, collegeId: user.collegeId },
      });
      if (!group) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Group not found' });
      }
      if (group.privacy === 'REQUEST') {
        const member = await this.prisma.groupMember.findFirst({
          where: { groupId: group.id, userId: user.id, status: 'ACTIVE' },
        });
        if (!member) {
          throw new ForbiddenException({
            code: 'MEMBERS_ONLY',
            message: 'Only members can view this group',
          });
        }
      }
    }

    const where: Prisma.PostWhereInput = {
      collegeId: user.collegeId,
      status: { not: 'REMOVED_BY_AUTHOR' },
      ...(query.groupId
        ? { groupId: query.groupId }
        : query.societyId
          ? { societyId: query.societyId }
          : { groupId: null, societyId: null }),
      ...(query.q ? { body: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.post.findMany({
        where,
        include: postInclude,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(query),
      }),
      this.prisma.post.count({ where }),
    ]);
    const likes = await this.prisma.like.findMany({
      where: { userId: user.id, postId: { in: rows.map((r) => r.id) } },
      select: { postId: true },
    });
    const likedSet = new Set(likes.map((l) => l.postId!));
    const data: PostItem[] = [];
    for (const row of rows) {
      data.push(await this.toItem(row, user, likedSet));
    }
    return { data, meta: pageMeta(query, total) };
  }

  async create(user: AuthenticatedUser, input: CreatePostInput): Promise<PostItem> {
    await this.access.assertParticipant(user);

    if (input.groupId && input.societyId) {
      throw new BadRequestException({
        code: 'INVALID_TARGET',
        message: 'A post belongs to a group or a society, not both',
      });
    }
    if (input.groupId) {
      const membership = await this.prisma.groupMember.findFirst({
        where: {
          groupId: input.groupId,
          userId: user.id,
          status: 'ACTIVE',
          group: { collegeId: user.collegeId, status: 'ACTIVE' },
        },
      });
      if (!membership) {
        throw new ForbiddenException({
          code: 'MEMBERS_ONLY',
          message: 'Join the group before posting in it',
        });
      }
    }
    if (input.societyId) {
      // Society walls: officers/president (or admins with societies.manage).
      const officer = await this.prisma.societyMember.findFirst({
        where: {
          societyId: input.societyId,
          userId: user.id,
          role: { in: ['OFFICER', 'PRESIDENT'] },
          status: 'ACTIVE',
          society: { collegeId: user.collegeId, status: 'ACTIVE' },
        },
      });
      const isManager = await this.policy.can(
        user,
        'community.societies.manage',
        {},
      );
      if (!officer && !isManager) {
        throw new ForbiddenException({
          code: 'OFFICERS_ONLY',
          message: 'Only society officers can post to the society wall',
        });
      }
    }
    if (input.resourceId) {
      const resource = await this.prisma.resource.findFirst({
        where: { id: input.resourceId, collegeId: user.collegeId },
      });
      if (!resource) {
        throw new BadRequestException({
          code: 'INVALID_RESOURCE',
          message: 'The shared resource does not exist',
        });
      }
    }
    if (input.eventId) {
      const event = await this.prisma.event.findFirst({
        where: { id: input.eventId, collegeId: user.collegeId },
      });
      if (!event) {
        throw new BadRequestException({
          code: 'INVALID_EVENT',
          message: 'The shared event does not exist',
        });
      }
    }

    const created = await this.prisma.post.create({
      data: {
        collegeId: user.collegeId,
        authorId: user.id,
        type: input.type,
        body: input.body,
        groupId: input.groupId,
        societyId: input.societyId,
        resourceId: input.resourceId,
        eventId: input.eventId,
      },
      include: postInclude,
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'community.post_created',
      targetType: 'Post',
      targetId: created.id,
    });
    return this.toItem(created, user);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdatePostInput,
  ): Promise<PostItem> {
    const post = await this.requirePost(user, id);
    if (post.authorId !== user.id || post.status !== 'ACTIVE') {
      throw forbidden();
    }
    const updated = await this.prisma.post.update({
      where: { id },
      data: { body: input.body },
      include: postInclude,
    });
    return this.toItem(updated, user);
  }

  /** Author delete → REMOVED_BY_AUTHOR; group moderator → REMOVED_BY_MODERATOR. */
  async remove(user: AuthenticatedUser, id: string): Promise<{ removed: true }> {
    const post = await this.requirePost(user, id);
    const isAuthor = post.authorId === user.id;
    const isModerator = await this.isGroupModerator(user.id, post.groupId);
    if (!isAuthor && !isModerator) throw forbidden();

    await this.prisma.$transaction(async (tx) => {
      await tx.post.update({
        where: { id },
        data: {
          status: isAuthor ? 'REMOVED_BY_AUTHOR' : 'REMOVED_BY_MODERATOR',
        },
      });
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: isAuthor
        ? 'community.post_removed_by_author'
        : 'community.post_removed_by_moderator',
      targetType: 'Post',
      targetId: id,
    });
    return { removed: true };
  }

  // ── Comments ───────────────────────────────────────────────

  async comments(
    user: AuthenticatedUser,
    postId: string,
  ): Promise<CommentItem[]> {
    await this.requirePost(user, postId);
    const rows = await this.prisma.comment.findMany({
      where: { postId, status: 'ACTIVE' },
      include: {
        author: { select: { id: true, firstName: true, lastName: true, role: true } },
        _count: { select: { likes: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const likes = await this.prisma.like.findMany({
      where: { userId: user.id, commentId: { in: rows.map((r) => r.id) } },
      select: { commentId: true },
    });
    const likedSet = new Set(likes.map((l) => l.commentId!));
    return rows.map((row) => ({
      id: row.id,
      author: {
        id: row.author.id,
        name: `${row.author.firstName} ${row.author.lastName}`,
        role: row.author.role,
      },
      body: row.body,
      parentId: row.parentId,
      likeCount: row._count.likes,
      likedByMe: likedSet.has(row.id),
      canDelete: row.authorId === user.id,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async addComment(
    user: AuthenticatedUser,
    postId: string,
    input: CreateCommentInput,
  ): Promise<CommentItem[]> {
    await this.access.assertParticipant(user);
    const post = await this.requirePost(user, postId);
    if (post.status !== 'ACTIVE') {
      throw new BadRequestException({
        code: 'POST_REMOVED',
        message: 'This post has been removed',
      });
    }
    if (input.parentId) {
      const parent = await this.prisma.comment.findFirst({
        where: { id: input.parentId, postId },
      });
      if (!parent) {
        throw new BadRequestException({
          code: 'INVALID_PARENT',
          message: 'The parent comment does not exist on this post',
        });
      }
      if (parent.parentId) {
        // One level of replies only (Blueprint §1).
        throw new BadRequestException({
          code: 'REPLY_DEPTH',
          message: 'Replies can only be one level deep',
        });
      }
    }

    await this.prisma.$transaction([
      this.prisma.comment.create({
        data: {
          postId,
          authorId: user.id,
          body: input.body,
          parentId: input.parentId,
        },
      }),
      this.prisma.post.update({
        where: { id: postId },
        data: { commentCount: { increment: 1 } },
      }),
    ]);

    if (post.authorId !== user.id) {
      this.events.emit({
        type: 'community.comment',
        actorUserId: user.id,
        actorName: `${user.firstName} ${user.lastName}`,
        targetOwnerUserId: post.authorId,
        postId,
      });
    }
    return this.comments(user, postId);
  }

  async removeComment(
    user: AuthenticatedUser,
    commentId: string,
  ): Promise<{ removed: true }> {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, post: { collegeId: user.collegeId } },
      include: { post: { select: { id: true, groupId: true } } },
    });
    if (!comment || comment.status !== 'ACTIVE') {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Comment not found' });
    }
    const isAuthor = comment.authorId === user.id;
    const isModerator = await this.isGroupModerator(user.id, comment.post.groupId);
    if (!isAuthor && !isModerator) throw forbidden();

    await this.prisma.$transaction([
      this.prisma.comment.update({
        where: { id: commentId },
        data: {
          status: isAuthor ? 'REMOVED_BY_AUTHOR' : 'REMOVED_BY_MODERATOR',
        },
      }),
      this.prisma.post.update({
        where: { id: comment.post.id },
        data: { commentCount: { decrement: 1 } },
      }),
    ]);
    return { removed: true };
  }

  // ── Likes ──────────────────────────────────────────────────

  async likePost(user: AuthenticatedUser, postId: string): Promise<PostItem> {
    await this.access.assertParticipant(user);
    const post = await this.requirePost(user, postId);
    const existing = await this.prisma.like.findFirst({
      where: { userId: user.id, postId },
    });
    if (!existing) {
      await this.prisma.$transaction([
        this.prisma.like.create({ data: { userId: user.id, postId } }),
        this.prisma.post.update({
          where: { id: postId },
          data: { likeCount: { increment: 1 } },
        }),
      ]);
      if (post.authorId !== user.id) {
        this.events.emit({
          type: 'community.like',
          actorUserId: user.id,
          actorName: `${user.firstName} ${user.lastName}`,
          targetOwnerUserId: post.authorId,
          postId,
        });
      }
    }
    const fresh = await this.prisma.post.findUniqueOrThrow({
      where: { id: postId },
      include: postInclude,
    });
    return this.toItem(fresh, user);
  }

  async unlikePost(user: AuthenticatedUser, postId: string): Promise<PostItem> {
    await this.requirePost(user, postId);
    const existing = await this.prisma.like.findFirst({
      where: { userId: user.id, postId },
    });
    if (existing) {
      await this.prisma.$transaction([
        this.prisma.like.delete({ where: { id: existing.id } }),
        this.prisma.post.update({
          where: { id: postId },
          data: { likeCount: { decrement: 1 } },
        }),
      ]);
    }
    const fresh = await this.prisma.post.findUniqueOrThrow({
      where: { id: postId },
      include: postInclude,
    });
    return this.toItem(fresh, user);
  }

  // ── helpers ────────────────────────────────────────────────

  private async requirePost(user: AuthenticatedUser, id: string) {
    const post = await this.prisma.post.findFirst({
      where: { id, collegeId: user.collegeId },
    });
    if (!post) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Post not found' });
    }
    return post;
  }
}
