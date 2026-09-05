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
  createTeacherSchema,
  paginationQuerySchema,
  updateTeacherSchema,
  PERMISSIONS,
  type CreateTeacherInput,
  type UpdateTeacherInput,
} from '@campusos/shared';
import { z } from 'zod';
import { TeachersService } from './teachers.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

const listQuerySchema = paginationQuerySchema.extend({
  departmentId: z.string().optional(),
});

@Controller('teachers')
export class TeachersController {
  constructor(private readonly teachers: TeachersService) {}

  @Get()
  @RequirePermission(PERMISSIONS.USERS_READ)
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listQuerySchema))
    query: z.infer<typeof listQuerySchema>,
  ) {
    return this.teachers.list(user, query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.USERS_MANAGE)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createTeacherSchema)) body: CreateTeacherInput,
  ) {
    return this.teachers.create(user, body);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.USERS_READ)
  async detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.teachers.detail(user, id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.USERS_MANAGE)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTeacherSchema)) body: UpdateTeacherInput,
  ) {
    return this.teachers.update(user, id, body);
  }
}
