import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { DepartmentsService } from './departments.service';
import { CoursesService } from './courses.service';
import { CalendarService } from './calendar.service';
import { RolloverService } from './rollover.service';
import { SectionsService } from './sections.service';
import {
  AcademicYearsController,
  CoursesController,
  DepartmentsController,
  SectionsController,
  TermsController,
} from './academics.controllers';

@Module({
  imports: [UsersModule],
  controllers: [
    DepartmentsController,
    CoursesController,
    AcademicYearsController,
    TermsController,
    SectionsController,
  ],
  providers: [
    DepartmentsService,
    CoursesService,
    CalendarService,
    RolloverService,
    SectionsService,
  ],
  exports: [DepartmentsService, CoursesService, CalendarService,
    RolloverService, SectionsService],
})
export class AcademicsModule {}
