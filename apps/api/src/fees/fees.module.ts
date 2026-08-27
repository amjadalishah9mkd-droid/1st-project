import { Module } from '@nestjs/common';
import { AcademicsModule } from '../academics/academics.module';
import { FeesService } from './fees.service';
import { FeesController } from './fees.controller';

@Module({
  imports: [AcademicsModule],
  controllers: [FeesController],
  providers: [FeesService],
  exports: [FeesService],
})
export class FeesModule {}
