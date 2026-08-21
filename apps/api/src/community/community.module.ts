import { Module } from '@nestjs/common';
import { CommunityController } from './community.controller';
import { CommunityAccessPolicy } from './community-access.policy';
import { PostsService } from './posts.service';
import { GroupsService } from './groups.service';
import {
  CommunityEventsService,
  ResourcesService,
  SocietiesService,
} from './community.services';

@Module({
  controllers: [CommunityController],
  providers: [
    CommunityAccessPolicy,
    PostsService,
    GroupsService,
    SocietiesService,
    CommunityEventsService,
    ResourcesService,
  ],
  exports: [CommunityAccessPolicy],
})
export class CommunityModule {}
