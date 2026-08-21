import { Module } from '@nestjs/common';
import { AttendanceListener } from './listeners/attendance.listener';

/**
 * Notifications module (M3 slice): event listeners that persist
 * Notification rows. The inbox/bell API surface arrives in M8.
 */
@Module({
  providers: [AttendanceListener],
})
export class NotificationsModule {}
