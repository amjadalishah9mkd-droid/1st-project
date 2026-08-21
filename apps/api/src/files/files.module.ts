import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { LocalStorageAdapter } from './storage.adapter';

@Module({
  controllers: [FilesController],
  providers: [LocalStorageAdapter],
  exports: [LocalStorageAdapter],
})
export class FilesModule {}
