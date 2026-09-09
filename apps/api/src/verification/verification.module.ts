import { Module } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { EvidenceRetentionService } from './evidence-retention.service';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [FilesModule],
  controllers: [VerificationController],
  providers: [VerificationService, EvidenceRetentionService],
})
export class VerificationModule {}
