import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  createExamPaperSchema,
  createExamSchema,
  gradeBandsUpdateSchema,
  paginationQuerySchema,
  resultsQuerySchema,
  saveMarksSchema,
  updateExamPaperSchema,
  updateExamSchema,
  PERMISSIONS,
  type CreateExamInput,
  type CreateExamPaperInput,
  type GradeBandsUpdateInput,
  type SaveMarksInput,
  type UpdateExamInput,
  type UpdateExamPaperInput,
} from '@campusos/shared';
import { z } from 'zod';
import { ExamsService } from './exams.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

const listQuerySchema = paginationQuerySchema.extend({
  termId: z.string().optional(),
});

@Controller()
export class ExamsController {
  constructor(private readonly exams: ExamsService) {}

  // ── Exams ──────────────────────────────────────────────────

  @Get('exams')
  @RequirePermission(PERMISSIONS.MARKS_ENTER)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listQuerySchema))
    query: z.infer<typeof listQuerySchema>,
  ) {
    return this.exams.list(user, query);
  }

  @Post('exams')
  @RequirePermission(PERMISSIONS.EXAMS_MANAGE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createExamSchema)) body: CreateExamInput,
  ) {
    return this.exams.create(user, body);
  }

  @Get('exams/:id')
  @RequirePermission(PERMISSIONS.MARKS_ENTER)
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.exams.detail(user, id);
  }

  @Patch('exams/:id')
  @RequirePermission(PERMISSIONS.EXAMS_MANAGE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateExamSchema)) body: UpdateExamInput,
  ) {
    return this.exams.update(user, id, body);
  }

  @Post('exams/:id/publish')
  @RequirePermission(PERMISSIONS.RESULTS_PUBLISH)
  publish(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.exams.publish(user, id);
  }

  // ── Papers ─────────────────────────────────────────────────

  @Post('exams/:id/papers')
  @RequirePermission(PERMISSIONS.EXAMS_MANAGE)
  createPaper(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createExamPaperSchema))
    body: CreateExamPaperInput,
  ) {
    return this.exams.createPaper(user, id, body);
  }

  @Patch('exams/:id/papers/:paperId')
  @RequirePermission(PERMISSIONS.EXAMS_MANAGE)
  updatePaper(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('paperId') paperId: string,
    @Body(new ZodValidationPipe(updateExamPaperSchema))
    body: UpdateExamPaperInput,
  ) {
    return this.exams.updatePaper(user, id, paperId, body);
  }

  // ── Marks ──────────────────────────────────────────────────

  @Get('papers/:id/marks')
  @RequirePermission(PERMISSIONS.MARKS_ENTER)
  marks(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.exams.marksSheet(user, id);
  }

  @Put('papers/:id/marks')
  @RequirePermission(PERMISSIONS.MARKS_ENTER)
  saveMarks(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(saveMarksSchema)) body: SaveMarksInput,
  ) {
    return this.exams.saveMarks(user, id, body);
  }

  // ── Results ────────────────────────────────────────────────

  @Get('results')
  @RequirePermission(PERMISSIONS.RESULTS_READ)
  results(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(resultsQuerySchema))
    query: z.infer<typeof resultsQuerySchema>,
  ) {
    return this.exams.results(user, query);
  }

  @Get('results/analytics')
  @RequirePermission(PERMISSIONS.EXAMS_MANAGE)
  analytics(
    @CurrentUser() user: AuthenticatedUser,
    @Query('examId') examId: string,
  ) {
    return this.exams.analytics(user, examId);
  }

  // ── Grade bands ────────────────────────────────────────────

  @Get('grade-bands')
  @RequirePermission(PERMISSIONS.RESULTS_READ)
  gradeBands(@CurrentUser() user: AuthenticatedUser) {
    return this.exams.gradeBands(user);
  }

  @Put('grade-bands')
  @RequirePermission(PERMISSIONS.SETTINGS_MANAGE)
  updateGradeBands(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(gradeBandsUpdateSchema))
    body: GradeBandsUpdateInput,
  ) {
    return this.exams.updateGradeBands(user, body);
  }
}
