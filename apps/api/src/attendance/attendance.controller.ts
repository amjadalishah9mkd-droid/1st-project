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
  attendanceSummaryQuerySchema,
  generateSessionsQuerySchema,
  saveAttendanceSchema,
  sessionsListQuerySchema,
  updateSessionSchema,
  PERMISSIONS,
  type SaveAttendanceInput,
  type UpdateSessionInput,
} from '@campusos/shared';
import { z } from 'zod';
import { AttendanceService } from './attendance.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

/**
 * Session + attendance endpoints (Blueprint §7).
 * Route params are named `sectionId` so PermissionsGuard forwards the
 * ASSIGNED-scope context automatically; session-level routes re-verify via
 * PolicyService inside the service (the section is derived from the row).
 */
@Controller()
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('sections/:sectionId/sessions/generate')
  @RequirePermission(PERMISSIONS.ATTENDANCE_RECORD)
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sectionId') sectionId: string,
    @Query(new ZodValidationPipe(generateSessionsQuerySchema))
    query: z.infer<typeof generateSessionsQuerySchema>,
  ) {
    return this.attendance.generateSessions(user, sectionId, query.weekOf);
  }

  @Get('sections/:sectionId/sessions')
  @RequirePermission(PERMISSIONS.ATTENDANCE_READ)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sectionId') sectionId: string,
    @Query(new ZodValidationPipe(sessionsListQuerySchema))
    query: z.infer<typeof sessionsListQuerySchema>,
  ) {
    return this.attendance.listSessions(user, sectionId, query);
  }

  @Patch('sessions/:id')
  @RequirePermission(PERMISSIONS.ATTENDANCE_RECORD)
  updateSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSessionSchema)) body: UpdateSessionInput,
  ) {
    return this.attendance.updateSession(user, id, body);
  }

  @Get('sessions/:id/attendance')
  @RequirePermission(PERMISSIONS.ATTENDANCE_RECORD)
  sheet(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.attendance.getSheet(user, id);
  }

  @Put('sessions/:id/attendance')
  @RequirePermission(PERMISSIONS.ATTENDANCE_RECORD)
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(saveAttendanceSchema)) body: SaveAttendanceInput,
  ) {
    return this.attendance.saveAttendance(user, id, body);
  }

  @Get('attendance/summary')
  @RequirePermission(PERMISSIONS.ATTENDANCE_READ)
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(attendanceSummaryQuerySchema))
    query: z.infer<typeof attendanceSummaryQuerySchema>,
  ) {
    return this.attendance.summary(user, query);
  }
}
