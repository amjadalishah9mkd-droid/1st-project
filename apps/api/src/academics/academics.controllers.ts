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
  assignTeacherSchema,
  createAcademicYearSchema,
  createCourseSchema,
  createDepartmentSchema,
  createSectionSchema,
  createRolloverSchema,
  createTermSchema,
  executeRolloverSchema,
  rolloverPlanSchema,
  paginationQuerySchema,
  updateAcademicYearSchema,
  updateCourseSchema,
  updateDepartmentSchema,
  updateSectionSchema,
  updateTermSchema,
  PERMISSIONS,
  type AssignTeacherInput,
  type CreateAcademicYearInput,
  type CreateCourseInput,
  type CreateDepartmentInput,
  type CreateSectionInput,
  type CreateRolloverInput,
  type CreateTermInput,
  type ExecuteRolloverInput,
  type RolloverPlanInput,
  type UpdateAcademicYearInput,
  type UpdateCourseInput,
  type UpdateDepartmentInput,
  type UpdateSectionInput,
  type UpdateTermInput,
} from '@campusos/shared';
import { z } from 'zod';
import { DepartmentsService } from './departments.service';
import { CoursesService } from './courses.service';
import { CalendarService } from './calendar.service';
import { RolloverService } from './rollover.service';
import { SectionsService } from './sections.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

const courseListSchema = paginationQuerySchema.extend({
  departmentId: z.string().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});
const sectionListSchema = paginationQuerySchema.extend({
  courseId: z.string().optional(),
  termId: z.string().optional(),
  mine: z.enum(['true', 'false']).optional(),
});

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.ACADEMICS_READ)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(paginationQuerySchema))
    query: z.infer<typeof paginationQuerySchema>,
  ) {
    return this.departments.list(user, query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.ACADEMICS_MANAGE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createDepartmentSchema))
    body: CreateDepartmentInput,
  ) {
    return this.departments.create(user, body);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.ACADEMICS_READ)
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.departments.detail(user, id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.ACADEMICS_MANAGE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDepartmentSchema))
    body: UpdateDepartmentInput,
  ) {
    return this.departments.update(user, id, body);
  }
}

@Controller('courses')
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  @RequirePermission(PERMISSIONS.ACADEMICS_READ)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(courseListSchema))
    query: z.infer<typeof courseListSchema>,
  ) {
    return this.courses.list(user, query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.ACADEMICS_MANAGE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createCourseSchema)) body: CreateCourseInput,
  ) {
    return this.courses.create(user, body);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.ACADEMICS_READ)
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.courses.detail(user, id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.ACADEMICS_MANAGE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCourseSchema)) body: UpdateCourseInput,
  ) {
    return this.courses.update(user, id, body);
  }
}

@Controller('academic-years')
export class AcademicYearsController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  @RequirePermission(PERMISSIONS.ACADEMICS_READ)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(paginationQuerySchema))
    query: z.infer<typeof paginationQuerySchema>,
  ) {
    return this.calendar.listYears(user, query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.ACADEMICS_MANAGE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createAcademicYearSchema))
    body: CreateAcademicYearInput,
  ) {
    return this.calendar.createYear(user, body);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.ACADEMICS_MANAGE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAcademicYearSchema))
    body: UpdateAcademicYearInput,
  ) {
    return this.calendar.updateYear(user, id, body);
  }
}

@Controller('terms')
export class TermsController {
  constructor(
    private readonly calendar: CalendarService,
    private readonly rollover: RolloverService,
  ) {}

  // ── M15-W2: term rollover (academics.manage; college-scoped) ──

  @Post(':id/rollover')
  @RequirePermission(PERMISSIONS.ACADEMICS_MANAGE)
  createRollover(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') toTermId: string,
    @Body(new ZodValidationPipe(createRolloverSchema)) body: CreateRolloverInput,
  ) {
    return this.rollover.createDraft(user, toTermId, body.fromTermId);
  }

  @Get(':id/rollover')
  @RequirePermission(PERMISSIONS.ACADEMICS_MANAGE)
  getRollover(@CurrentUser() user: AuthenticatedUser, @Param('id') toTermId: string) {
    return this.rollover.preview(user, toTermId);
  }

  @Patch(':id/rollover')
  @RequirePermission(PERMISSIONS.ACADEMICS_MANAGE)
  updateRollover(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') toTermId: string,
    @Body(new ZodValidationPipe(rolloverPlanSchema)) body: RolloverPlanInput,
  ) {
    return this.rollover.updatePlan(user, toTermId, body);
  }

  @Post(':id/rollover/execute')
  @RequirePermission(PERMISSIONS.ACADEMICS_MANAGE)
  executeRollover(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') toTermId: string,
    @Body(new ZodValidationPipe(executeRolloverSchema)) body: ExecuteRolloverInput,
  ) {
    return this.rollover.execute(user, toTermId, body.confirmLabel);
  }

  @Get()
  @RequirePermission(PERMISSIONS.ACADEMICS_READ)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(paginationQuerySchema))
    query: z.infer<typeof paginationQuerySchema>,
  ) {
    return this.calendar.listTerms(user, query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.ACADEMICS_MANAGE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createTermSchema)) body: CreateTermInput,
  ) {
    return this.calendar.createTerm(user, body);
  }

  @Patch(':id/set-current')
  @RequirePermission(PERMISSIONS.ACADEMICS_MANAGE)
  setCurrent(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.calendar.setCurrentTerm(user, id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.ACADEMICS_MANAGE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTermSchema)) body: UpdateTermInput,
  ) {
    return this.calendar.updateTerm(user, id, body);
  }
}

@Controller('sections')
export class SectionsController {
  constructor(private readonly sections: SectionsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.ACADEMICS_READ)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(sectionListSchema))
    query: z.infer<typeof sectionListSchema>,
  ) {
    return this.sections.list(user, query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.ACADEMICS_MANAGE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createSectionSchema)) body: CreateSectionInput,
  ) {
    return this.sections.create(user, body);
  }

  @Get(':id/overview')
  @RequirePermission(PERMISSIONS.ACADEMICS_READ)
  overview(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sections.overview(user, id);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.ACADEMICS_READ)
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sections.detail(user, id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.ACADEMICS_MANAGE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSectionSchema)) body: UpdateSectionInput,
  ) {
    return this.sections.update(user, id, body);
  }

  @Post(':id/enrollments/:studentId')
  @RequirePermission(PERMISSIONS.ENROLLMENT_MANAGE)
  enroll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('studentId') studentId: string,
  ) {
    return this.sections.enroll(user, id, studentId);
  }

  @Delete(':id/enrollments/:studentId')
  @RequirePermission(PERMISSIONS.ENROLLMENT_MANAGE)
  unenroll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('studentId') studentId: string,
  ) {
    return this.sections.unenroll(user, id, studentId);
  }

  @Post(':id/teachers/:teacherId')
  @RequirePermission(PERMISSIONS.ENROLLMENT_MANAGE)
  assignTeacher(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('teacherId') teacherId: string,
    @Body(new ZodValidationPipe(assignTeacherSchema)) body: AssignTeacherInput,
  ) {
    return this.sections.assignTeacher(user, id, teacherId, body);
  }

  @Delete(':id/teachers/:teacherId')
  @RequirePermission(PERMISSIONS.ENROLLMENT_MANAGE)
  unassignTeacher(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('teacherId') teacherId: string,
  ) {
    return this.sections.unassignTeacher(user, id, teacherId);
  }
}
