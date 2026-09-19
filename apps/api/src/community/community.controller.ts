import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  createCommentSchema,
  createEventSchema,
  createGroupSchema,
  createPostSchema,
  createResourceSchema,
  createSocietySchema,
  paginationQuerySchema,
  rsvpSchema,
  societyMemberSchema,
  updateEventSchema,
  updateGroupSchema,
  updatePostSchema,
  updateSocietySchema,
  PERMISSIONS,
  type CreateCommentInput,
  type CreateEventInput,
  type CreateGroupInput,
  type CreatePostInput,
  type CreateResourceInput,
  type CreateSocietyInput,
  type RsvpInput,
  type SocietyMemberInput,
  type UpdateEventInput,
  type UpdateGroupInput,
  type UpdatePostInput,
  type UpdateSocietyInput,
} from '@campusos/shared';
import { z } from 'zod';
import { PostsService } from './posts.service';
import { GroupsService } from './groups.service';
import {
  CommunityEventsService,
  ResourcesService,
  SocietiesService,
} from './community.services';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

const feedQuerySchema = paginationQuerySchema.extend({
  groupId: z.string().optional(),
  societyId: z.string().optional(),
});
const resourceQuerySchema = paginationQuerySchema.extend({
  courseId: z.string().optional(),
});

/**
 * Community endpoints (Blueprint §7). Every route requires the
 * community.participate grant; writes additionally pass through
 * CommunityAccessPolicy (ACTIVE + not suspended) inside the services, and
 * object-level rules (group moderators, society officers) are enforced there.
 */
@Controller('community')
@RequirePermission(PERMISSIONS.COMMUNITY_PARTICIPATE)
export class CommunityController {
  constructor(
    private readonly posts: PostsService,
    private readonly groups: GroupsService,
    private readonly societies: SocietiesService,
    private readonly communityEvents: CommunityEventsService,
    private readonly resources: ResourcesService,
  ) {}

  // ── Posts ──────────────────────────────────────────────────

  @Get('posts')
  listPosts(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(feedQuerySchema))
    query: z.infer<typeof feedQuerySchema>,
  ) {
    return this.posts.list(user, query);
  }

  @Post('posts')
  createPost(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createPostSchema)) body: CreatePostInput,
  ) {
    return this.posts.create(user, body);
  }

  @Patch('posts/:id')
  updatePost(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePostSchema)) body: UpdatePostInput,
  ) {
    return this.posts.update(user, id, body);
  }

  @Delete('posts/:id')
  removePost(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.posts.remove(user, id);
  }

  @Get('posts/:id/comments')
  comments(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.posts.comments(user, id);
  }

  @Post('posts/:id/comments')
  addComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createCommentSchema)) body: CreateCommentInput,
  ) {
    return this.posts.addComment(user, id, body);
  }

  @Delete('comments/:id')
  removeComment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.posts.removeComment(user, id);
  }

  @Put('posts/:id/like')
  like(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.posts.likePost(user, id);
  }

  @Delete('posts/:id/like')
  unlike(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.posts.unlikePost(user, id);
  }

  // ── Groups ─────────────────────────────────────────────────

  @Get('groups')
  listGroups(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(paginationQuerySchema))
    query: z.infer<typeof paginationQuerySchema>,
  ) {
    return this.groups.list(user, query);
  }

  @Post('groups')
  createGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createGroupSchema)) body: CreateGroupInput,
  ) {
    return this.groups.create(user, body);
  }

  @Get('groups/:id')
  groupDetail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.groups.detail(user, id);
  }

  @Patch('groups/:id')
  updateGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateGroupSchema)) body: UpdateGroupInput,
  ) {
    return this.groups.update(user, id, body);
  }

  @Post('groups/:id/membership')
  joinGroup(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.groups.join(user, id);
  }

  @Delete('groups/:id/membership')
  leaveGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('userId') userId?: string,
  ) {
    return this.groups.leave(user, id, userId);
  }

  @Patch('groups/:id/membership/:userId/approve')
  approveMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.groups.approve(user, id, userId);
  }

  // ── Societies ──────────────────────────────────────────────

  @Get('societies')
  listSocieties(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(paginationQuerySchema))
    query: z.infer<typeof paginationQuerySchema>,
  ) {
    return this.societies.list(user, query);
  }

  @Post('societies')
  createSociety(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createSocietySchema)) body: CreateSocietyInput,
  ) {
    return this.societies.create(user, body);
  }

  @Get('societies/:id')
  societyDetail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.societies.detail(user, id);
  }

  @Patch('societies/:id')
  updateSociety(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSocietySchema)) body: UpdateSocietyInput,
  ) {
    return this.societies.update(user, id, body);
  }

  @Post('societies/:id/members')
  upsertSocietyMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(societyMemberSchema)) body: SocietyMemberInput,
  ) {
    return this.societies.upsertMember(user, id, body);
  }

  @Delete('societies/:id/members/:userId')
  removeSocietyMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.societies.removeMember(user, id, userId);
  }

  // ── Events ─────────────────────────────────────────────────

  @Get('events')
  listEvents(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(feedQuerySchema))
    query: z.infer<typeof feedQuerySchema>,
  ) {
    return this.communityEvents.list(user, query);
  }

  @Post('events')
  createEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createEventSchema)) body: CreateEventInput,
  ) {
    return this.communityEvents.create(user, body);
  }

  @Patch('events/:id')
  updateEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateEventSchema)) body: UpdateEventInput,
  ) {
    return this.communityEvents.update(user, id, body);
  }

  @Put('events/:id/rsvp')
  rsvp(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rsvpSchema)) body: RsvpInput,
  ) {
    return this.communityEvents.rsvp(user, id, body);
  }

  // ── Resources ──────────────────────────────────────────────

  @Get('resources')
  listResources(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(resourceQuerySchema))
    query: z.infer<typeof resourceQuerySchema>,
  ) {
    return this.resources.list(user, query);
  }

  @Post('resources')
  createResource(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createResourceSchema)) body: CreateResourceInput,
  ) {
    return this.resources.create(user, body);
  }

  @Get('resources/:id/download')
  download(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.resources.download(user, id);
  }
}
