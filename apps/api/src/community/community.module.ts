import { Module } from '@nestjs/common';
import { CommunityController } from './community.controller';
import { ModerationController } from './moderation.controller';
import { CommunityAccessPolicy } from './community-access.policy';
import { PostsService } from './posts.service';
import { GroupsService } from './groups.service';
import { ModerationService } from './moderation.service';
import {
  CommunityEventsService,
  ResourcesService,
  SocietiesService,
} from './community.services';

@Module({
  controllers: [CommunityController, ModerationController],
  providers: [
    CommunityAccessPolicy,
    PostsService,
    GroupsService,
    SocietiesService,
    CommunityEventsService,
    ResourcesService,
    ModerationService,
  ],
  exports: [CommunityAccessPolicy],
})
export class CommunityModule {}
