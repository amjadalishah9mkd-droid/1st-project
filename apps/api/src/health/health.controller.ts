import { Controller, Get } from '@nestjs/common';
import { readdir, stat, access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import type { HealthStatus, OpsHealthStatus } from '@campusos/shared';
import { PERMISSIONS } from '@campusos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';
import { RequirePermission } from '../access/require-permission.decorator';

/**
 * M19-W3 — freshness threshold: sidecar dumps every 24h, so anything older
 * than 26h means at least one missed cycle. Overridable for ops tuning.
 */
const DEFAULT_BACKUP_MAX_AGE_SECONDS = 26 * 60 * 60;

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

  /**
   * M19-W3 — deep operational health (O-4 internal-only V1).
   * Gated by the existing settings.manage permission (PolicyService decides;
   * no role checks). Response is deliberately free of credentials, DSNs,
   * filesystem paths and filenames — ages and counts only.
   */
  @RequirePermission(PERMISSIONS.SETTINGS_MANAGE)
  @Get('ops')
  async ops(): Promise<OpsHealthStatus> {
    const databaseUp = await this.prisma.isHealthy();
    const migrations = databaseUp
      ? await this.migrationState()
      : { applied: 0, unfinished: 0 };
    const backups = await this.backupState();
    const uploadsWritable = await this.uploadsWritable();
    const degraded =
      !databaseUp ||
      migrations.unfinished > 0 ||
      !uploadsWritable ||
      (backups.configured && backups.stale);
    return {
      status: degraded ? 'degraded' : 'ok',
      database: databaseUp ? 'up' : 'down',
      migrations,
      backups,
      uploadsWritable,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  private async migrationState(): Promise<{
    applied: number;
    unfinished: number;
  }> {
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ applied: bigint; unfinished: bigint }>
      >`SELECT
          count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied,
          count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS unfinished
        FROM "_prisma_migrations"`;
      return {
        applied: Number(rows[0]?.applied ?? 0),
        unfinished: Number(rows[0]?.unfinished ?? 0),
      };
    } catch {
      return { applied: 0, unfinished: 0 };
    }
  }

  /**
   * Backup freshness from the read-only pgbackups mount (BACKUP_DIR).
   * Server-configured directory only — never a client-supplied path.
   * In-progress `.partial` files are ignored so a crashed dump can never
   * count as a fresh backup.
   */
  private async backupState(): Promise<OpsHealthStatus['backups']> {
    const dir = process.env.BACKUP_DIR;
    const maxAge = Number(
      process.env.BACKUP_MAX_AGE_SECONDS ?? DEFAULT_BACKUP_MAX_AGE_SECONDS,
    );
    if (!dir) {
      return { configured: false, count: 0, latestAgeSeconds: null, stale: false };
    }
    try {
      const names = (await readdir(dir)).filter(
        (name) => /^campusos-.*\.dump$/.test(name),
      );
      let newestMtime = 0;
      for (const name of names) {
        const info = await stat(join(dir, name));
        if (info.mtimeMs > newestMtime) newestMtime = info.mtimeMs;
      }
      const latestAgeSeconds =
        names.length > 0 ? Math.floor((Date.now() - newestMtime) / 1000) : null;
      return {
        configured: true,
        count: names.length,
        latestAgeSeconds,
        stale: latestAgeSeconds === null || latestAgeSeconds > maxAge,
      };
    } catch {
      // Directory configured but unreadable/missing — that IS a finding.
      return { configured: true, count: 0, latestAgeSeconds: null, stale: true };
    }
  }

  private async uploadsWritable(): Promise<boolean> {
    const dir = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');
    try {
      await access(dir, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}
