import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuditModule } from './audit/audit.module';
import { AccessModule } from './access/access.module';
import { AuthModule } from './auth/auth.module';

/**
 * Module graph through M1: infrastructure + auth & access.
 * Feature modules (users, academics, …) are added per milestone as defined
 * in Blueprint §6/§13 — none are stubbed here.
 */
@Module({
  imports: [
    EventEmitterModule.forRoot(),
    PrismaModule,
    AuditModule,
    AccessModule,
    AuthModule,
    HealthModule,
  ],
})
export class AppModule {}
