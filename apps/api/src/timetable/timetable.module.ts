import { Module } from '@nestjs/common';
import { AcademicsModule } from '../academics/academics.module';
import { TimetableService } from './timetable.service';
import { TimetableController } from './timetable.controller';

@Module({
  imports: [AcademicsModule],
  controllers: [TimetableController],
  providers: [TimetableService],
  exports: [TimetableService],
})
export class TimetableModule {}
