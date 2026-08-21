import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Demo seed (Blueprint §8 — layer 2, gated by SEED_DEMO=true). Idempotent.
 *
 * Keeps the original three demo accounts and, from M2, adds a realistic
 * academic structure: 4 departments, 8 courses, 2 terms, 6 sections,
 * 4 extra teachers, 12 extra students, enrollments and teaching assignments.
 *
 * Demo credentials (development only): CampusOS!demo1
 *   admin@campusos.dev / teacher@campusos.dev / student@campusos.dev
 */
const DEMO_PASSWORD = 'CampusOS!demo1';

export async function runDemoSeed(
  prisma: PrismaClient,
  collegeId: string,
): Promise<void> {
  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
  });

  // ── Departments ──────────────────────────────────────────────
  const departmentSpecs = [
    { code: 'CS', name: 'Computer Science' },
    { code: 'EE', name: 'Electrical Engineering' },
    { code: 'BUS', name: 'Business Administration' },
    { code: 'HUM', name: 'Humanities' },
  ];
  const departments = new Map<string, string>();
  for (const spec of departmentSpecs) {
    const department = await prisma.department.upsert({
      where: { collegeId_code: { collegeId, code: spec.code } },
      update: { name: spec.name },
      create: { collegeId, ...spec },
    });
    departments.set(spec.code, department.id);
  }

  // ── Core demo users ──────────────────────────────────────────
  async function upsertUser(spec: {
    email: string;
    role: 'ADMIN' | 'TEACHER' | 'STUDENT';
    firstName: string;
    lastName: string;
  }) {
    return prisma.user.upsert({
      where: { collegeId_email: { collegeId, email: spec.email } },
      update: {},
      create: {
        collegeId,
        email: spec.email,
        passwordHash,
        role: spec.role,
        status: 'ACTIVE',
        firstName: spec.firstName,
        lastName: spec.lastName,
        mustChangePassword: false,
      },
    });
  }

  await upsertUser({
    email: 'admin@campusos.dev',
    role: 'ADMIN',
    firstName: 'Ayesha',
    lastName: 'Rahman',
  });

  // ── Teachers (demo teacher + 4 more) ─────────────────────────
  const teacherSpecs = [
    {
      email: 'teacher@campusos.dev',
      firstName: 'Daniel',
      lastName: 'Okafor',
      employeeNo: 'EMP-1001',
      designation: 'Assistant Professor',
      qualification: 'PhD, Computer Science',
      department: 'CS',
      joinedOn: '2022-08-15',
    },
    {
      email: 'sara.malik@campusos.dev',
      firstName: 'Sara',
      lastName: 'Malik',
      employeeNo: 'EMP-1002',
      designation: 'Associate Professor',
      qualification: 'PhD, Machine Learning',
      department: 'CS',
      joinedOn: '2019-01-10',
    },
    {
      email: 'victor.chen@campusos.dev',
      firstName: 'Victor',
      lastName: 'Chen',
      employeeNo: 'EMP-1003',
      designation: 'Professor',
      qualification: 'PhD, Power Systems',
      department: 'EE',
      joinedOn: '2015-09-01',
    },
    {
      email: 'lina.novak@campusos.dev',
      firstName: 'Lina',
      lastName: 'Novak',
      employeeNo: 'EMP-1004',
      designation: 'Lecturer',
      qualification: 'MBA',
      department: 'BUS',
      joinedOn: '2023-02-20',
    },
    {
      email: 'omar.haddad@campusos.dev',
      firstName: 'Omar',
      lastName: 'Haddad',
      employeeNo: 'EMP-1005',
      designation: 'Lecturer',
      qualification: 'MA, English Literature',
      department: 'HUM',
      joinedOn: '2021-08-01',
    },
  ];
  const teacherProfiles = new Map<string, string>(); // employeeNo → profile id
  for (const spec of teacherSpecs) {
    const user = await upsertUser({
      email: spec.email,
      role: 'TEACHER',
      firstName: spec.firstName,
      lastName: spec.lastName,
    });
    const profile = await prisma.teacherProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        collegeId,
        departmentId: departments.get(spec.department)!,
        employeeNo: spec.employeeNo,
        designation: spec.designation,
        qualification: spec.qualification,
        joinedOn: new Date(spec.joinedOn),
      },
    });
    teacherProfiles.set(spec.employeeNo, profile.id);
  }

  // ── Students (demo student + 12 more) ────────────────────────
  const studentSpecs: Array<{
    email: string;
    firstName: string;
    lastName: string;
    admissionNo: string;
    rollNo: string;
    batch: string;
    department: string;
  }> = [
    { email: 'student@campusos.dev', firstName: 'Mina', lastName: 'Petrova', admissionNo: 'ADM-2026-0001', rollNo: 'CS-26-001', batch: '2026', department: 'CS' },
    { email: 'jonas.weber@campusos.dev', firstName: 'Jonas', lastName: 'Weber', admissionNo: 'ADM-2026-0002', rollNo: 'CS-26-002', batch: '2026', department: 'CS' },
    { email: 'aisha.khan@campusos.dev', firstName: 'Aisha', lastName: 'Khan', admissionNo: 'ADM-2026-0003', rollNo: 'CS-26-003', batch: '2026', department: 'CS' },
    { email: 'ravi.sharma@campusos.dev', firstName: 'Ravi', lastName: 'Sharma', admissionNo: 'ADM-2026-0004', rollNo: 'CS-26-004', batch: '2026', department: 'CS' },
    { email: 'sofia.rossi@campusos.dev', firstName: 'Sofia', lastName: 'Rossi', admissionNo: 'ADM-2026-0005', rollNo: 'CS-26-005', batch: '2026', department: 'CS' },
    { email: 'noah.brown@campusos.dev', firstName: 'Noah', lastName: 'Brown', admissionNo: 'ADM-2026-0006', rollNo: 'EE-26-001', batch: '2026', department: 'EE' },
    { email: 'zara.ali@campusos.dev', firstName: 'Zara', lastName: 'Ali', admissionNo: 'ADM-2026-0007', rollNo: 'EE-26-002', batch: '2026', department: 'EE' },
    { email: 'leo.park@campusos.dev', firstName: 'Leo', lastName: 'Park', admissionNo: 'ADM-2026-0008', rollNo: 'EE-26-003', batch: '2026', department: 'EE' },
    { email: 'emma.silva@campusos.dev', firstName: 'Emma', lastName: 'Silva', admissionNo: 'ADM-2026-0009', rollNo: 'BUS-26-001', batch: '2026', department: 'BUS' },
    { email: 'ali.demir@campusos.dev', firstName: 'Ali', lastName: 'Demir', admissionNo: 'ADM-2026-0010', rollNo: 'BUS-26-002', batch: '2026', department: 'BUS' },
    { email: 'nina.ivanova@campusos.dev', firstName: 'Nina', lastName: 'Ivanova', admissionNo: 'ADM-2026-0011', rollNo: 'HUM-26-001', batch: '2026', department: 'HUM' },
    { email: 'tom.evans@campusos.dev', firstName: 'Tom', lastName: 'Evans', admissionNo: 'ADM-2026-0012', rollNo: 'HUM-26-002', batch: '2026', department: 'HUM' },
    { email: 'maya.das@campusos.dev', firstName: 'Maya', lastName: 'Das', admissionNo: 'ADM-2026-0013', rollNo: 'CS-26-006', batch: '2026', department: 'CS' },
  ];
  const studentProfiles = new Map<string, string>(); // admissionNo → profile id
  for (const spec of studentSpecs) {
    const user = await upsertUser({
      email: spec.email,
      role: 'STUDENT',
      firstName: spec.firstName,
      lastName: spec.lastName,
    });
    const profile = await prisma.studentProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        collegeId,
        departmentId: departments.get(spec.department)!,
        admissionNo: spec.admissionNo,
        rollNo: spec.rollNo,
        batch: spec.batch,
        status: 'ENROLLED',
      },
    });
    studentProfiles.set(spec.admissionNo, profile.id);
  }

  // ── Terms (Fall 2026 is current via system seed; add Spring 2027) ──
  const year = await prisma.academicYear.findFirstOrThrow({
    where: { collegeId, label: '2026–27' },
  });
  const fall = await prisma.term.findFirstOrThrow({
    where: { collegeId, label: 'Fall 2026' },
  });
  await prisma.term.upsert({
    where: { academicYearId_label: { academicYearId: year.id, label: 'Spring 2027' } },
    update: {},
    create: {
      collegeId,
      academicYearId: year.id,
      label: 'Spring 2027',
      startsOn: new Date('2027-01-11'),
      endsOn: new Date('2027-05-21'),
      isCurrent: false,
    },
  });

  // ── Courses ──────────────────────────────────────────────────
  const courseSpecs = [
    { code: 'CS-101', title: 'Introduction to Programming', credits: 4, department: 'CS' },
    { code: 'CS-201', title: 'Data Structures & Algorithms', credits: 4, department: 'CS' },
    { code: 'CS-305', title: 'Database Systems', credits: 3, department: 'CS' },
    { code: 'EE-110', title: 'Circuit Analysis', credits: 4, department: 'EE' },
    { code: 'EE-220', title: 'Digital Logic Design', credits: 3, department: 'EE' },
    { code: 'BUS-101', title: 'Principles of Management', credits: 3, department: 'BUS' },
    { code: 'HUM-150', title: 'Academic Writing', credits: 2, department: 'HUM' },
    { code: 'HUM-201', title: 'World Literature', credits: 3, department: 'HUM' },
  ];
  const courses = new Map<string, string>();
  for (const spec of courseSpecs) {
    const course = await prisma.course.upsert({
      where: { collegeId_code: { collegeId, code: spec.code } },
      update: {},
      create: {
        collegeId,
        departmentId: departments.get(spec.department)!,
        code: spec.code,
        title: spec.title,
        credits: spec.credits,
      },
    });
    courses.set(spec.code, course.id);
  }

  // ── Sections (Fall 2026) ─────────────────────────────────────
  const sectionSpecs = [
    { course: 'CS-101', name: 'A', capacity: 30, room: 'CS-Lab 1' },
    { course: 'CS-201', name: 'A', capacity: 30, room: 'CS-204' },
    { course: 'CS-305', name: 'A', capacity: 25, room: 'CS-305' },
    { course: 'EE-110', name: 'A', capacity: 28, room: 'EE-101' },
    { course: 'BUS-101', name: 'A', capacity: 40, room: 'BUS-Hall 2' },
    { course: 'HUM-150', name: 'A', capacity: 35, room: 'HUM-12' },
  ];
  const sections = new Map<string, string>(); // "COURSE/NAME" → id
  for (const spec of sectionSpecs) {
    const courseId = courses.get(spec.course)!;
    const section = await prisma.section.upsert({
      where: {
        courseId_termId_name: { courseId, termId: fall.id, name: spec.name },
      },
      update: {},
      create: {
        collegeId,
        courseId,
        termId: fall.id,
        name: spec.name,
        capacity: spec.capacity,
        room: spec.room,
      },
    });
    sections.set(`${spec.course}/${spec.name}`, section.id);
  }

  // ── Teaching assignments ─────────────────────────────────────
  const assignmentSpecs = [
    { employeeNo: 'EMP-1001', section: 'CS-101/A', isPrimary: true },
    { employeeNo: 'EMP-1001', section: 'CS-201/A', isPrimary: true },
    { employeeNo: 'EMP-1002', section: 'CS-305/A', isPrimary: true },
    { employeeNo: 'EMP-1002', section: 'CS-101/A', isPrimary: false },
    { employeeNo: 'EMP-1003', section: 'EE-110/A', isPrimary: true },
    { employeeNo: 'EMP-1004', section: 'BUS-101/A', isPrimary: true },
    { employeeNo: 'EMP-1005', section: 'HUM-150/A', isPrimary: true },
  ];
  for (const spec of assignmentSpecs) {
    const teacherId = teacherProfiles.get(spec.employeeNo)!;
    const sectionId = sections.get(spec.section)!;
    await prisma.teachingAssignment.upsert({
      where: { teacherId_sectionId: { teacherId, sectionId } },
      update: { isPrimary: spec.isPrimary },
      create: { teacherId, sectionId, isPrimary: spec.isPrimary },
    });
  }

  // ── Enrollments ──────────────────────────────────────────────
  const enrollmentSpecs: Array<{ admissionNo: string; sections: string[] }> = [
    { admissionNo: 'ADM-2026-0001', sections: ['CS-101/A', 'CS-201/A', 'HUM-150/A'] },
    { admissionNo: 'ADM-2026-0002', sections: ['CS-101/A', 'CS-201/A'] },
    { admissionNo: 'ADM-2026-0003', sections: ['CS-101/A', 'CS-305/A'] },
    { admissionNo: 'ADM-2026-0004', sections: ['CS-101/A', 'CS-201/A', 'CS-305/A'] },
    { admissionNo: 'ADM-2026-0005', sections: ['CS-101/A', 'HUM-150/A'] },
    { admissionNo: 'ADM-2026-0006', sections: ['EE-110/A', 'HUM-150/A'] },
    { admissionNo: 'ADM-2026-0007', sections: ['EE-110/A'] },
    { admissionNo: 'ADM-2026-0008', sections: ['EE-110/A', 'CS-101/A'] },
    { admissionNo: 'ADM-2026-0009', sections: ['BUS-101/A', 'HUM-150/A'] },
    { admissionNo: 'ADM-2026-0010', sections: ['BUS-101/A'] },
    { admissionNo: 'ADM-2026-0011', sections: ['HUM-150/A', 'BUS-101/A'] },
    { admissionNo: 'ADM-2026-0012', sections: ['HUM-150/A'] },
    { admissionNo: 'ADM-2026-0013', sections: ['CS-201/A', 'CS-305/A'] },
  ];
  for (const spec of enrollmentSpecs) {
    const studentId = studentProfiles.get(spec.admissionNo)!;
    for (const key of spec.sections) {
      const sectionId = sections.get(key)!;
      await prisma.enrollment.upsert({
        where: { studentId_sectionId: { studentId, sectionId } },
        update: {},
        create: { studentId, sectionId, status: 'ACTIVE' },
      });
    }
  }
}
