import { Module } from '@nestjs/common';
import { AttendanceListener } from './listeners/attendance.listener';
import { AssignmentsListener } from './listeners/assignments.listener';
import { ResultsListener } from './listeners/results.listener';
import { FeesListener } from './listeners/fees.listener';
import { CommunityListener } from './listeners/community.listener';
import { PlatformListener } from './listeners/platform.listener';
import { VerificationListener } from './listeners/verification.listener';
import { InboxService, NotificationsController } from './inbox.controller';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { AnnouncementsModule } from '../announcements/announcements.module';

/**
 * Notifications module (complete in M8): event listeners persisting
 * Notification rows, the inbox API, and the daily scheduled sweeps.
 */
@Module({
  imports: [AnnouncementsModule],
  controllers: [NotificationsController],
  providers: [
    AttendanceListener,
    AssignmentsListener,
    ResultsListener,
    FeesListener,
    CommunityListener,
    PlatformListener,
    VerificationListener,
    InboxService,
    NotificationSchedulerService,
  ],
  exports: [NotificationSchedulerService],
})
export class NotificationsModule {}
