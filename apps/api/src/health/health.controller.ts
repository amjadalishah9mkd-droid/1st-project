import { Controller, Get } from '@nestjs/common';
import type { HealthStatus } from '@campusos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health(): Promise<HealthStatus> {
    const databaseUp = await this.prisma.isHealthy();
    return {
      status: 'ok',
      service: 'campusos-api',
      version: process.env.npm_package_version ?? '0.1.0',
      database: databaseUp ? 'up' : 'down',
      timestamp: new Date().toISOString(),
    };
  }
}
