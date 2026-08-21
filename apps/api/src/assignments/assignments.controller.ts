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
  createAssignmentSchema,
  gradeSubmissionSchema,
  paginationQuerySchema,
  submitAssignmentSchema,
  updateAssignmentSchema,
  PERMISSIONS,
  type CreateAssignmentInput,
  type GradeSubmissionInput,
  type SubmitAssignmentInput,
  type UpdateAssignmentInput,
} from '@campusos/shared';
import { z } from 'zod';
import { AssignmentsService } from './assignments.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentUser } from '../access/current-user.decorator';
import type { AuthenticatedUser } from '../access/authenticated-user';

const listQuerySchema = paginationQuerySchema.extend({
  sectionId: z.string().optional(),
});

@Controller()
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get('assignments')
  @RequirePermission(PERMISSIONS.ASSIGNMENTS_READ)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listQuerySchema))
    query: z.infer<typeof listQuerySchema>,
  ) {
    return this.assignments.list(user, query);
  }

  @Post('assignments')
  @RequirePermission(PERMISSIONS.ASSIGNMENTS_MANAGE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createAssignmentSchema))
    body: CreateAssignmentInput,
  ) {
    return this.assignments.create(user, body);
  }

  @Get('assignments/:id')
  @RequirePermission(PERMISSIONS.ASSIGNMENTS_READ)
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.assignments.detail(user, id);
  }

  @Patch('assignments/:id')
  @RequirePermission(PERMISSIONS.ASSIGNMENTS_MANAGE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAssignmentSchema))
    body: UpdateAssignmentInput,
  ) {
    return this.assignments.update(user, id, body);
  }

  @Delete('assignments/:id')
  @RequirePermission(PERMISSIONS.ASSIGNMENTS_MANAGE)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.assignments.remove(user, id);
  }

  @Post('assignments/:id/publish')
  @RequirePermission(PERMISSIONS.ASSIGNMENTS_MANAGE)
  publish(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.assignments.publish(user, id);
  }

  @Get('assignments/:id/submissions')
  @RequirePermission(PERMISSIONS.ASSIGNMENTS_GRADE)
  submissions(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.assignments.submissions(user, id);
  }

  @Post('assignments/:id/submissions')
  @RequirePermission(PERMISSIONS.ASSIGNMENTS_SUBMIT)
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(submitAssignmentSchema))
    body: SubmitAssignmentInput,
  ) {
    return this.assignments.submit(user, id, body);
  }

  @Patch('submissions/:id/grade')
  @RequirePermission(PERMISSIONS.ASSIGNMENTS_GRADE)
  grade(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(gradeSubmissionSchema))
    body: GradeSubmissionInput,
  ) {
    return this.assignments.grade(user, id, body);
  }
}
