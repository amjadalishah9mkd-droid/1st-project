import { Module } from '@nestjs/common';
import {
  DashboardsController,
  DashboardsService,
} from './dashboards.module-parts';

@Module({
  controllers: [DashboardsController],
  providers: [DashboardsService],
})
export class DashboardsModule {}
