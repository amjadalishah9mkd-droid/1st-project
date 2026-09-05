import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { LocalStorageAdapter } from './storage.adapter';
import { FileUrlSignerService } from './url-signer.service';
import { EvidenceAuthzService } from './evidence-authz.service';
import { StoredFileAuthzService } from './stored-file-authz.service';

@Module({
  controllers: [FilesController],
  providers: [LocalStorageAdapter, FileUrlSignerService, EvidenceAuthzService, StoredFileAuthzService],
  exports: [LocalStorageAdapter, FileUrlSignerService, EvidenceAuthzService, StoredFileAuthzService],
})
export class FilesModule {}
