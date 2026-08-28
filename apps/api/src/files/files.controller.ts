import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  signFileUrlSchema,
  type SignFileUrlInput,
  type SignedFileUrl,
  type UploadedFileInfo,
} from '@campusos/shared';
import { LocalStorageAdapter } from './storage.adapter';
import { FileUrlSignerService } from './url-signer.service';
import { EvidenceAuthzService } from './evidence-authz.service';
import { StoredFileAuthzService } from './stored-file-authz.service';
import { RateLimiterService } from '../common/rate-limiter.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../access/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const FILE_URL_PREFIX = '/api/v1/files/';

/**
 * File endpoints (M10-W1 hardened).
 *  - POST /files       — authenticated upload; returns the internal URL that
 *                        modules store (unchanged format).
 *  - POST /files/sign  — authenticated; exchanges an internal file URL for a
 *                        signed, 5-minute download URL. Only CampusOS-internal
 *                        URLs are accepted — arbitrary URLs cannot be signed.
 *  - GET  /files/:key  — requires a valid exp+sig pair (HMAC, timing-safe).
 *                        Unsigned, tampered and expired links are rejected.
 */
@Controller('files')
export class FilesController {
  constructor(
    private readonly storage: LocalStorageAdapter,
    private readonly signer: FileUrlSignerService,
    private readonly evidenceAuthz: EvidenceAuthzService,
    private readonly storedFileAuthz: StoredFileAuthzService,
    private readonly limiter: RateLimiterService,
  ) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }),
  )
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<UploadedFileInfo> {
    this.limiter.assert('fileUpload', user.id);
    if (!file || file.size === 0) {
      throw new BadRequestException({
        code: 'MISSING_FILE',
        message: 'Upload a file in the "file" field',
      });
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: 'Files are limited to 10 MB',
      });
    }
    const stored = await this.storage.save(file.buffer, file.originalname);
    // M19-W1: every new upload gets an ownership record (tenant + owner),
    // enforced at sign time by StoredFileAuthzService.
    await this.storedFileAuthz.record({
      key: stored.key,
      collegeId: user.collegeId,
      ownerUserId: user.id,
    });
    return {
      url: `${FILE_URL_PREFIX}${stored.key}`,
      name: file.originalname,
      size: stored.size,
    };
  }

  @Post('sign')
  async signUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(signFileUrlSchema)) body: SignFileUrlInput,
  ): Promise<SignedFileUrl> {
    this.limiter.assert('fileSign', user.id);
    // Strictly internal URLs only: exact prefix, then a single key segment
    // that must survive the storage adapter's own key rules.
    if (!body.url.startsWith(FILE_URL_PREFIX)) {
      throw new BadRequestException({
        code: 'INVALID_FILE_URL',
        message: 'Only CampusOS file URLs can be signed',
      });
    }
    const key = decodeURIComponent(body.url.slice(FILE_URL_PREFIX.length));
    if (
      key.length === 0 ||
      key.includes('/') ||
      key.includes('\\') ||
      key.includes('..') ||
      key.includes('?') ||
      key.includes('#')
    ) {
      throw new BadRequestException({
        code: 'INVALID_FILE_URL',
        message: 'Only CampusOS file URLs can be signed',
      });
    }
    // M11-W3: verification evidence is a restricted file class. Signing —
    // the only way to a working URL — requires per-user authorization.
    await this.evidenceAuthz.assertCanSign(user, key);
    // M19-W1 (P2-IDOR-1): tenant/ownership authorization for every key with
    // an ownership record; unknown keys are grandfathered pre-M19 uploads.
    await this.storedFileAuthz.assertCanSign(user, key);
    const { exp, sig } = this.signer.sign(key);
    return {
      url: `${FILE_URL_PREFIX}${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  /**
   * Signed download. @Public because browser navigation cannot attach
   * bearer headers — access control is the HMAC signature issued to an
   * authenticated caller moments earlier, not obscurity.
   */
  @Public()
  @Get(':key')
  async serve(
    @Param('key') key: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!exp || !sig) {
      throw new ForbiddenException({
        code: 'SIGNATURE_REQUIRED',
        message: 'This file link must be signed. Request a fresh link.',
      });
    }
    if (!this.signer.verify(key, exp, sig)) {
      if (this.signer.isExpired(key, exp, sig)) {
        throw new ForbiddenException({
          code: 'LINK_EXPIRED',
          message: 'This file link has expired. Request a fresh link.',
        });
      }
      throw new ForbiddenException({
        code: 'INVALID_SIGNATURE',
        message: 'This file link is not valid.',
      });
    }

    const file = await this.storage.open(key);
    if (!file) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'File not found',
      });
    }
    res.setHeader('Content-Length', file.size);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.name)}"`,
    );
    file.stream.pipe(res);
  }
}
