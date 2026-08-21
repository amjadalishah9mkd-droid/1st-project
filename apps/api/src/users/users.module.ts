import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller';
import { TeachersController } from './teachers.controller';
import { StudentsService } from './students.service';
import { StudentsImportService } from './students-import.service';
import { TeachersService } from './teachers.service';

@Module({
  controllers: [StudentsController, TeachersController],
  providers: [StudentsService, StudentsImportService, TeachersService],
  exports: [StudentsService, TeachersService],
})
export class UsersModule {}
