import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';

/**
 * M0 module graph: infrastructure only.
 * Feature modules (auth, access, users, academics, …) are added per milestone
 * as defined in Blueprint §6/§13 — none are stubbed here.
 */
@Module({
  imports: [
    EventEmitterModule.forRoot(),
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
