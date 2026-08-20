import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Demo seed (Blueprint §8 — layer 2, gated by SEED_DEMO=true).
 * M0 scope: exactly three demo users — ADMIN, TEACHER, STUDENT — with the
 * supporting rows their profiles require (one department). Wider demo data
 * (courses, sections, enrollments, community content, …) lands with the
 * milestones that implement those modules.
 *
 * Demo credentials (development only):
 *   admin@campusos.dev   / CampusOS!demo1
 *   teacher@campusos.dev / CampusOS!demo1
 *   student@campusos.dev / CampusOS!demo1
 */
const DEMO_PASSWORD = 'CampusOS!demo1';

export async function runDemoSeed(
  prisma: PrismaClient,
  collegeId: string,
): Promise<void> {
  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
  });

  // Supporting department required by teacher/student profiles.
  const department = await prisma.department.upsert({
    where: { collegeId_code: { collegeId, code: 'CS' } },
    update: {},
    create: {
      collegeId,
      code: 'CS',
      name: 'Computer Science',
    },
  });

  // ── ADMIN ───────────────────────────────────────────────────
  await prisma.user.upsert({
    where: {
      collegeId_email: { collegeId, email: 'admin@campusos.dev' },
    },
    update: {},
    create: {
      collegeId,
      email: 'admin@campusos.dev',
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
      firstName: 'Ayesha',
      lastName: 'Rahman',
      mustChangePassword: false,
    },
  });

  // ── TEACHER (user + TeacherProfile) ─────────────────────────
  const teacherUser = await prisma.user.upsert({
    where: {
      collegeId_email: { collegeId, email: 'teacher@campusos.dev' },
    },
    update: {},
    create: {
      collegeId,
      email: 'teacher@campusos.dev',
      passwordHash,
      role: 'TEACHER',
      status: 'ACTIVE',
      firstName: 'Daniel',
      lastName: 'Okafor',
      mustChangePassword: false,
    },
  });
  await prisma.teacherProfile.upsert({
    where: { userId: teacherUser.id },
    update: {},
    create: {
      userId: teacherUser.id,
      collegeId,
      departmentId: department.id,
      employeeNo: 'EMP-1001',
      designation: 'Assistant Professor',
      qualification: 'PhD, Computer Science',
      joinedOn: new Date('2022-08-15'),
    },
  });

  // ── STUDENT (user + StudentProfile) ─────────────────────────
  const studentUser = await prisma.user.upsert({
    where: {
      collegeId_email: { collegeId, email: 'student@campusos.dev' },
    },
    update: {},
    create: {
      collegeId,
      email: 'student@campusos.dev',
      passwordHash,
      role: 'STUDENT',
      status: 'ACTIVE',
      firstName: 'Mina',
      lastName: 'Petrova',
      mustChangePassword: false,
    },
  });
  await prisma.studentProfile.upsert({
    where: { userId: studentUser.id },
    update: {},
    create: {
      userId: studentUser.id,
      collegeId,
      departmentId: department.id,
      admissionNo: 'ADM-2026-0001',
      rollNo: 'CS-26-001',
      batch: '2026',
      status: 'ENROLLED',
    },
  });
}
