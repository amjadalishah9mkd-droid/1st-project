import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
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

/**
 * Module graph through M3: infrastructure + auth/access + academic core +
 * timetable & attendance + event-driven notification rows.
 */
@Module({
  imports: [
    EventEmitterModule.forRoot(),
    PrismaModule,
    AuditModule,
    AccessModule,
    AuthModule,
    UsersModule,
    AcademicsModule,
    EventsModule,
    NotificationsModule,
    TimetableModule,
    AttendanceModule,
    HealthModule,
  ],
})
export class AppModule {}
