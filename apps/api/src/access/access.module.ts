import { Global, Module } from '@nestjs/common';
import { PolicyService } from './policy.service';
import { PermissionsGuard } from './permissions.guard';
import { AccessController } from './access.controller';

@Global()
@Module({
  controllers: [AccessController],
  providers: [PolicyService, PermissionsGuard],
  exports: [PolicyService, PermissionsGuard],
})
export class AccessModule {}
