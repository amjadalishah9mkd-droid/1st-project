import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuditModule } from './audit/audit.module';
import { AccessModule } from './access/access.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AcademicsModule } from './academics/academics.module';
import { EventsModule } from './events/events.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TimetableModule } from './timetable/timetable.module';
import { AttendanceModule } from './attendance/attendance.module';
import { FilesModule } from './files/files.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { ExamsModule } from './exams/exams.module';
import { FeesModule } from './fees/fees.module';
import { PaymentsModule } from './payments/payments.module';
import { CommunityModule } from './community/community.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { DashboardsModule } from './dashboards/dashboards.module';
import { VerificationModule } from './verification/verification.module';
import { RateLimitModule } from './common/rate-limiter.service';
import { SettingsModule } from './settings/settings.module';
import { MailModule } from './mail/mail.module';
import { ExportsModule } from './exports/exports.module';

/**
 * Complete module graph (M0–M9): the full CampusOS MVP per Blueprint §6.
 */
@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    PrismaModule,
    RateLimitModule,
    MailModule,
    AuditModule,
    AccessModule,
    AuthModule,
    UsersModule,
    AcademicsModule,
    EventsModule,
    AnnouncementsModule,
    NotificationsModule,
    TimetableModule,
    AttendanceModule,
    FilesModule,
    AssignmentsModule,
    ExamsModule,
    FeesModule,
    PaymentsModule,
    CommunityModule,
    DashboardsModule,
    VerificationModule,
    SettingsModule,
    ExportsModule,
    HealthModule,
  ],
})
export class AppModule {}
