import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createReportSchema,
  moderationActionSchema,
  paginationQuerySchema,
  resolveReportSchema,
  PERMISSIONS,
  type CreateReportInput,
  type ModerationActionInput,
  type ResolveReportInput,
} from '@campusos/shared';
import { z } from 'zod';
import { ModerationService } from './moderation.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

const queueQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED']).optional(),
});

/** Reporting (any participant) + admin moderation queue (Blueprint §7/§11). */
@Controller()
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Post('community/reports')
  @RequirePermission(PERMISSIONS.COMMUNITY_REPORT)
  report(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createReportSchema)) body: CreateReportInput,
  ) {
    return this.moderation.createReport(user, body);
  }

  @Get('moderation/reports')
  @RequirePermission(PERMISSIONS.MODERATION_ACT)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(queueQuerySchema))
    query: z.infer<typeof queueQuerySchema>,
  ) {
    return this.moderation.listReports(user, query);
  }

  @Get('moderation/reports/:id')
  @RequirePermission(PERMISSIONS.MODERATION_ACT)
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.moderation.reportDetail(user, id);
  }

  @Patch('moderation/reports/:id')
  @RequirePermission(PERMISSIONS.MODERATION_ACT)
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolveReportSchema)) body: ResolveReportInput,
  ) {
    return this.moderation.resolveReport(user, id, body);
  }

  @Post('moderation/actions')
  @RequirePermission(PERMISSIONS.MODERATION_ACT)
  act(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(moderationActionSchema))
    body: ModerationActionInput,
  ) {
    return this.moderation.act(user, body);
  }
}
