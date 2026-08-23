import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  EVIDENCE_MAX_BYTES,
  PERMISSIONS,
  claimDecisionSchema,
  paginationQuerySchema,
  submitClaimSchema,
  type ClaimAdminItem,
  type ClaimDecisionInput,
  type MyClaimItem,
  type PaginationQuery,
  type SubmitClaimInput,
} from '@campusos/shared';
import { z } from 'zod';
import { VerificationService } from './verification.service';
import { RateLimiterService } from '../common/rate-limiter.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

const claimListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
});
type ClaimListQuery = PaginationQuery & { status?: string };

/**
 * M11-W3 — verification endpoints. Authorization is exclusively
 * PolicyService via @RequirePermission:
 *   verification.submit (STUDENT/OWN) — evidence upload, claim, own status
 *   verification.manage (ADMIN/ALL)  — queue, detail, decisions
 */
@Controller('verification')
export class VerificationController {
  constructor(
    private readonly verification: VerificationService,
    private readonly limiter: RateLimiterService,
  ) {}

  @Post('evidence')
  @RequirePermission(PERMISSIONS.VERIFICATION_SUBMIT)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: EVIDENCE_MAX_BYTES } }),
  )
  uploadEvidence(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ evidenceFileKey: string; name: string; size: number }> {
    this.limiter.assert('evidenceUpload', user.id);
    return this.verification.uploadEvidence(user, file);
  }

  @Post('claims')
  @RequirePermission(PERMISSIONS.VERIFICATION_SUBMIT)
  submitClaim(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(submitClaimSchema)) body: SubmitClaimInput,
  ): Promise<MyClaimItem> {
    this.limiter.assert('claimSubmit', user.id);
    return this.verification.submitClaim(user, body);
  }

  @Get('claims/me')
  @RequirePermission(PERMISSIONS.VERIFICATION_SUBMIT)
  myClaims(@CurrentUser() user: AuthenticatedUser): Promise<MyClaimItem[]> {
    return this.verification.myClaims(user);
  }

  @Get('claims')
  @RequirePermission(PERMISSIONS.VERIFICATION_MANAGE)
  listClaims(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(claimListQuerySchema)) query: ClaimListQuery,
  ) {
    return this.verification.listClaims(user, query);
  }

  @Get('claims/:id')
  @RequirePermission(PERMISSIONS.VERIFICATION_MANAGE)
  claimDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ClaimAdminItem> {
    return this.verification.claimDetail(user, id);
  }

  @Post('claims/:id/decision')
  @RequirePermission(PERMISSIONS.VERIFICATION_MANAGE)
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(claimDecisionSchema)) body: ClaimDecisionInput,
  ): Promise<ClaimAdminItem> {
    return this.verification.decide(user, id, body);
  }
}
