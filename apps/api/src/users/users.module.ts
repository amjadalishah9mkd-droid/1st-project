import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StudentsController } from './students.controller';
import { TeachersController } from './teachers.controller';
import { UsersController } from './users.controller';
import {
  GuardianSelfController,
  StudentGuardiansController,
} from './guardians.controller';
import { GuardiansService } from './guardians.service';
import { StudentsService } from './students.service';
import { StudentsImportService } from './students-import.service';
import { TeachersService } from './teachers.service';

@Module({
  imports: [AuthModule],
  controllers: [
    StudentsController,
    TeachersController,
    UsersController,
    StudentGuardiansController,
    GuardianSelfController,
  ],
  providers: [
    StudentsService,
    StudentsImportService,
    TeachersService,
    GuardiansService,
  ],
  exports: [StudentsService, TeachersService],
})
export class UsersModule {}
