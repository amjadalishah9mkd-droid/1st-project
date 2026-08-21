import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createSlotSchema,
  updateSlotSchema,
  PERMISSIONS,
  type CreateSlotInput,
  type UpdateSlotInput,
} from '@campusos/shared';
import { z } from 'zod';
import { TimetableService } from './timetable.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

const viewQuerySchema = z.object({
  view: z
    .string()
    .regex(/^(me|section:[\w-]+)$/, 'view must be me or section:<id>')
    .default('me'),
});

@Controller('timetable')
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  @Get()
  @RequirePermission(PERMISSIONS.TIMETABLE_READ)
  read(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(viewQuerySchema))
    query: z.infer<typeof viewQuerySchema>,
  ) {
    return this.timetable.read(user, query.view);
  }

  @Post('slots')
  @RequirePermission(PERMISSIONS.TIMETABLE_MANAGE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createSlotSchema)) body: CreateSlotInput,
  ) {
    return this.timetable.createSlot(user, body);
  }

  @Patch('slots/:id')
  @RequirePermission(PERMISSIONS.TIMETABLE_MANAGE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSlotSchema)) body: UpdateSlotInput,
  ) {
    return this.timetable.updateSlot(user, id, body);
  }

  @Delete('slots/:id')
  @RequirePermission(PERMISSIONS.TIMETABLE_MANAGE)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.timetable.deleteSlot(user, id);
  }
}
