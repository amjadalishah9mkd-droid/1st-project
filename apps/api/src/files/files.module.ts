import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { LocalStorageAdapter } from './storage.adapter';
import { FileUrlSignerService } from './url-signer.service';

@Module({
  controllers: [FilesController],
  providers: [LocalStorageAdapter, FileUrlSignerService],
  exports: [LocalStorageAdapter, FileUrlSignerService],
})
export class FilesModule {}
