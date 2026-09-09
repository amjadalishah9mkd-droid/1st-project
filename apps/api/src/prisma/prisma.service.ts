import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService — single database access point.
 *
 * Tenant safety (Blueprint §1): CampusOS runs single-college in the MVP but
 * every aggregate root carries collegeId. `forCollege()` is the scoping seam:
 * feature services must obtain college-scoped filters through it rather than
 * hand-writing collegeId conditions, so multi-tenant row scoping later is a
 * change in exactly one place.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Returns the tenant filter for the given college. */
  forCollege(collegeId: string): { collegeId: string } {
    return { collegeId };
  }

  /** Lightweight connectivity probe used by the health endpoint. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
