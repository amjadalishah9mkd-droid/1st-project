import { Module } from '@nestjs/common';
import { AttendanceListener } from './listeners/attendance.listener';
import { AssignmentsListener } from './listeners/assignments.listener';
import { ResultsListener } from './listeners/results.listener';

/**
 * Notifications module: event listeners that persist Notification rows.
 * The inbox/bell API surface arrives in M8.
 */
@Module({
  providers: [AttendanceListener, AssignmentsListener, ResultsListener],
})
export class NotificationsModule {}
