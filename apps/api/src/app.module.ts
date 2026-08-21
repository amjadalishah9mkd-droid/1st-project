import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuditModule } from './audit/audit.module';
import { AccessModule } from './access/access.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AcademicsModule } from './academics/academics.module';

/**
 * Module graph through M2: infrastructure + auth/access + academic core.
 * Remaining feature modules are added per milestone (Blueprint §6/§13).
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
    HealthModule,
  ],
})
export class AppModule {}
