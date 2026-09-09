import { Body, Controller, Get, Module, Patch } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  GOOGLE_AUTH_MODES,
  PERMISSIONS,
  collegeSettingsSchema,
  readCollegeSettings,
  type CollegeSettings,
} from '@campusos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

/**
 * M11-W7 — college settings (Google-auth rollout controls, decision R2).
 * Tenant-scoped by the caller's collegeId; authorized exclusively via
 * settings.manage (PolicyService); validated with the shared
 * collegeSettingsSchema; every change audited. PATCH is a merge — unknown
 * settings keys are preserved (schema passthrough), and omitted fields
 * keep their current values.
 */
const patchSettingsSchema = z
  .object({
    googleAuth: z.enum(GOOGLE_AUTH_MODES).optional(),
    allowSelfRegistration: z.boolean().optional(),
    googleAuthGraceDays: z.number().int().min(0).max(365).optional(),
    // M21-W2 (O-6): display-only attendance warning threshold.
    attendanceWarningThreshold: z.number().int().min(0).max(100).optional(),
  })
  .strict();
type PatchSettingsInput = z.infer<typeof patchSettingsSchema>;

export interface CollegeSettingsPayload {
  name: string;
  code: string;
  settings: CollegeSettings;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(user: AuthenticatedUser): Promise<CollegeSettingsPayload> {
    const college = await this.prisma.college.findUniqueOrThrow({
      where: { id: user.collegeId },
    });
    return {
      name: college.name,
      code: college.code,
      settings: readCollegeSettings(college.settings),
    };
  }

  async patch(
    user: AuthenticatedUser,
    input: PatchSettingsInput,
  ): Promise<CollegeSettingsPayload> {
    const college = await this.prisma.college.findUniqueOrThrow({
      where: { id: user.collegeId },
    });
    const current = (college.settings ?? {}) as Record<string, unknown>;
    const merged = collegeSettingsSchema.parse({ ...current, ...input });

    await this.prisma.college.update({
      where: { id: user.collegeId },
      data: { settings: merged as never },
    });
    await this.audit.log({
      collegeId: user.collegeId,
      actorId: user.id,
      action: 'settings.updated',
      targetType: 'College',
      targetId: user.collegeId,
      metadata: { changed: Object.keys(input) },
    });
    return { name: college.name, code: college.code, settings: merged };
  }
}

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('college')
  @RequirePermission(PERMISSIONS.SETTINGS_MANAGE)
  get(@CurrentUser() user: AuthenticatedUser): Promise<CollegeSettingsPayload> {
    return this.settings.get(user);
  }

  @Patch('college')
  @RequirePermission(PERMISSIONS.SETTINGS_MANAGE)
  patch(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(patchSettingsSchema)) body: PatchSettingsInput,
  ): Promise<CollegeSettingsPayload> {
    return this.settings.patch(user, body);
  }
}

@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
