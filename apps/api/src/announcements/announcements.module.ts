import { Module } from '@nestjs/common';
import {
  AnnouncementsController,
  AnnouncementsService,
} from './announcements.module-parts';

@Module({
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
