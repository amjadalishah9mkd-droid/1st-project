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
  examAnalyticsQuerySchema,
  gradeBandsUpdateSchema,
  paginationQuerySchema,
  resultsQuerySchema,
  saveMarksSchema,
  studentTargetQuerySchema,
  updateExamPaperSchema,
  updateExamSchema,
  finalizeResultSchema,
  finalizeBatchSchema,
  voidResultSchema,
  amendResultSchema,
  type FinalizeResultInput,
  type FinalizeBatchInput,
  type VoidResultInput,
  type AmendResultInput,
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
import { ResultsFinalizationService } from './results-finalization.service';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

const listQuerySchema = paginationQuerySchema.extend({
  termId: z.string().optional(),
});

@Controller()
export class ExamsController {
  constructor(
    private readonly exams: ExamsService,
    private readonly finalization: ResultsFinalizationService,
  ) {}

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
    // M24-W1 (N-1): validated BEFORE the service can run a query. An
    // omitted or array-valued examId is now a 400; previously it reached
    // Prisma as `undefined` and collapsed the tenancy predicate.
    @Query(new ZodValidationPipe(examAnalyticsQuerySchema))
    query: z.infer<typeof examAnalyticsQuerySchema>,
  ) {
    return this.exams.analytics(user, query.examId);
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

  // ── M18-W1: academic result finalization (results.finalize) ──

  @Post('results/terms/:termId/finalize')
  @RequirePermission(PERMISSIONS.RESULTS_FINALIZE)
  finalize(
    @CurrentUser() user: AuthenticatedUser,
    @Param('termId') termId: string,
    @Body(new ZodValidationPipe(finalizeResultSchema)) body: FinalizeResultInput,
  ) {
    return this.finalization.finalize(user, termId, body.studentId, body.confirmLabel);
  }

  @Post('results/records/:id/amend')
  @RequirePermission(PERMISSIONS.RESULTS_FINALIZE)
  amend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(amendResultSchema)) body: AmendResultInput,
  ) {
    return this.finalization.amend(user, id, body.reason, body.confirmLabel);
  }

  @Post('results/terms/:termId/finalize-batch')
  @RequirePermission(PERMISSIONS.RESULTS_FINALIZE)
  finalizeBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('termId') termId: string,
    @Body(new ZodValidationPipe(finalizeBatchSchema)) body: FinalizeBatchInput,
  ) {
    return this.finalization.finalizeBatch(
      user,
      termId,
      body.studentIds,
      body.confirmLabel,
    );
  }

  @Post('results/records/:id/void')
  @RequirePermission(PERMISSIONS.RESULTS_FINALIZE)
  void(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(voidResultSchema)) body: VoidResultInput,
  ) {
    return this.finalization.void(user, id, body.reason, body.confirmLabel);
  }

  @Get('results/terms/:termId/finalization')
  @RequirePermission(PERMISSIONS.RESULTS_FINALIZE)
  finalizationList(
    @CurrentUser() user: AuthenticatedUser,
    @Param('termId') termId: string,
  ) {
    return this.finalization.finalizationList(user, termId);
  }

  // Reads ride the existing results.read scopes
  // (OWN/CHILD/ASSIGNED/ALL — ASSIGNED narrowed in M23-W1).
  // M24-W1 (N-1 array class): studentId is validated as a scalar string;
  // an array or duplicated parameter previously reached Prisma as a 500.
  @Get('results/report/term/:termId')
  @RequirePermission(PERMISSIONS.RESULTS_READ)
  reportCard(
    @CurrentUser() user: AuthenticatedUser,
    @Param('termId') termId: string,
    @Query(new ZodValidationPipe(studentTargetQuerySchema))
    query: z.infer<typeof studentTargetQuerySchema>,
  ) {
    return this.finalization.report(user, termId, query.studentId);
  }

  @Get('results/transcript')
  @RequirePermission(PERMISSIONS.RESULTS_READ)
  transcript(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(studentTargetQuerySchema))
    query: z.infer<typeof studentTargetQuerySchema>,
  ) {
    return this.finalization.transcript(user, query.studentId);
  }
}
