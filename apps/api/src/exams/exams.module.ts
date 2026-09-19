import { Module } from '@nestjs/common';
import { AcademicsModule } from '../academics/academics.module';
import { ExamsService } from './exams.service';
import { ResultsFinalizationService } from './results-finalization.service';
import { ExamsController } from './exams.controller';

@Module({
  imports: [AcademicsModule],
  controllers: [ExamsController],
  providers: [ExamsService, ResultsFinalizationService],
  exports: [ExamsService],
})
export class ExamsModule {}
