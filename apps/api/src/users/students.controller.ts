import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  createStudentSchema,
  paginationQuerySchema,
  updateStudentSchema,
  PERMISSIONS,
  type CreateStudentInput,
  type UpdateStudentInput,
} from '@campusos/shared';
import { z } from 'zod';
import { StudentsService } from './students.service';
import { StudentsImportService } from './students-import.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

const listQuerySchema = paginationQuerySchema.extend({
  departmentId: z.string().optional(),
  sectionId: z.string().optional(),
});

@Controller('students')
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly importer: StudentsImportService,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.USERS_READ)
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listQuerySchema))
    query: z.infer<typeof listQuerySchema>,
  ) {
    return this.students.list(user, query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.USERS_MANAGE)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createStudentSchema)) body: CreateStudentInput,
  ) {
    return this.students.create(user, body);
  }

  @Post('import')
  @RequirePermission(PERMISSIONS.USERS_MANAGE)
  @UseInterceptors(FileInterceptor('file'))
  async import(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file || file.size === 0) {
      throw new BadRequestException({
        code: 'MISSING_FILE',
        message: 'Upload a CSV file in the "file" field',
      });
    }
    if (file.size > 1024 * 1024) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: 'CSV imports are limited to 1 MB',
      });
    }
    return this.importer.import(user, file.buffer.toString('utf8'));
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.USERS_READ)
  async detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.students.detail(user, id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.USERS_MANAGE)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateStudentSchema)) body: UpdateStudentInput,
  ) {
    return this.students.update(user, id, body);
  }
}
