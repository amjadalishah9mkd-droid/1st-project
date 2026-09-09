import { Module } from '@nestjs/common';
import { AcademicsModule } from '../academics/academics.module';
import { FeesService } from './fees.service';
import { FeesController } from './fees.controller';
import { FinanceDocumentsService } from './finance-documents.service';
import { FinanceDocumentsController } from './finance-documents.controller';

@Module({
  imports: [AcademicsModule],
  controllers: [FeesController, FinanceDocumentsController],
  providers: [FeesService, FinanceDocumentsService],
  exports: [FeesService, FinanceDocumentsService],
})
export class FeesModule {}
