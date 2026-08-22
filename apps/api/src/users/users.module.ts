import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StudentsController } from './students.controller';
import { TeachersController } from './teachers.controller';
import { UsersController } from './users.controller';
import { StudentsService } from './students.service';
import { StudentsImportService } from './students-import.service';
import { TeachersService } from './teachers.service';

@Module({
  imports: [AuthModule],
  controllers: [StudentsController, TeachersController, UsersController],
  providers: [StudentsService, StudentsImportService, TeachersService],
  exports: [StudentsService, TeachersService],
})
export class UsersModule {}
