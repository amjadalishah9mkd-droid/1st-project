import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { UploadedFileInfo } from '@campusos/shared';
import { LocalStorageAdapter } from './storage.adapter';
import { CurrentUser } from '../access/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * File upload/serve endpoints (Blueprint §7: POST /files → {url}).
 * Authenticated users upload; files are served back only to authenticated
 * users. Keys are 128-bit random — unguessable by construction.
 */
@Controller('files')
export class FilesController {
  constructor(private readonly storage: LocalStorageAdapter) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser() _user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<UploadedFileInfo> {
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
    return {
      url: `/api/v1/files/${stored.key}`,
      name: file.originalname,
      size: stored.size,
    };
  }

  /**
   * Download by capability key. Browser navigation (href downloads) cannot
   * attach bearer headers, so access control is the 128-bit random key
   * itself; uploads always require authentication.
   */
  @Public()
  @Get(':key')
  async serve(
    @Param('key') key: string,
    @Res() res: Response,
  ): Promise<void> {
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
