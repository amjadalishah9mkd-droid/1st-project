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

  // ── Timetable slots (M3) ─────────────────────────────────────
  const slotSpecs: Array<{
    section: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    room: string;
  }> = [
    { section: 'CS-101/A', dayOfWeek: 1, startTime: '09:00', endTime: '10:30', room: 'CS-Lab 1' },
    { section: 'CS-101/A', dayOfWeek: 3, startTime: '09:00', endTime: '10:30', room: 'CS-Lab 1' },
    { section: 'CS-201/A', dayOfWeek: 2, startTime: '11:00', endTime: '12:30', room: 'CS-204' },
    { section: 'CS-201/A', dayOfWeek: 4, startTime: '11:00', endTime: '12:30', room: 'CS-204' },
    { section: 'CS-305/A', dayOfWeek: 1, startTime: '14:00', endTime: '15:30', room: 'CS-305' },
    { section: 'CS-305/A', dayOfWeek: 3, startTime: '14:00', endTime: '15:30', room: 'CS-305' },
    { section: 'EE-110/A', dayOfWeek: 2, startTime: '09:00', endTime: '10:30', room: 'EE-101' },
    { section: 'EE-110/A', dayOfWeek: 5, startTime: '09:00', endTime: '10:30', room: 'EE-101' },
    { section: 'BUS-101/A', dayOfWeek: 1, startTime: '11:00', endTime: '12:00', room: 'BUS-Hall 2' },
    { section: 'BUS-101/A', dayOfWeek: 4, startTime: '11:00', endTime: '12:00', room: 'BUS-Hall 2' },
    { section: 'HUM-150/A', dayOfWeek: 2, startTime: '14:00', endTime: '15:00', room: 'HUM-12' },
    { section: 'HUM-150/A', dayOfWeek: 5, startTime: '14:00', endTime: '15:00', room: 'HUM-12' },
  ];
  const slotIds = new Map<string, string>(); // "SECTION/day/start" → id
  for (const spec of slotSpecs) {
    const sectionId = sections.get(spec.section)!;
    let slot = await prisma.timetableSlot.findFirst({
      where: {
        sectionId,
        dayOfWeek: spec.dayOfWeek,
        startTime: spec.startTime,
      },
    });
    if (!slot) {
      slot = await prisma.timetableSlot.create({
        data: {
          sectionId,
          dayOfWeek: spec.dayOfWeek,
          startTime: spec.startTime,
          endTime: spec.endTime,
          room: spec.room,
        },
      });
    }
    slotIds.set(`${spec.section}/${spec.dayOfWeek}/${spec.startTime}`, slot.id);
  }

  // ── Sessions + attendance history (past 2 weeks + current week) ──
  const adminUser = await prisma.user.findFirstOrThrow({
    where: { collegeId, email: 'admin@campusos.dev' },
  });
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const day = today.getUTCDay();
  const thisMonday = new Date(today);
  thisMonday.setUTCDate(today.getUTCDate() + (day === 0 ? -6 : 1 - day));

  const weekMondays = [-2, -1, 0].map((offset) => {
    const monday = new Date(thisMonday);
    monday.setUTCDate(thisMonday.getUTCDate() + offset * 7);
    return monday;
  });

  // Deterministic ~88%-present pattern.
  function statusFor(admissionNo: string, dateKey: string):
    | 'PRESENT'
    | 'ABSENT'
    | 'LATE' {
    let hash = 0;
    const seed = `${admissionNo}:${dateKey}`;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    const bucket = hash % 100;
    if (bucket < 84) return 'PRESENT';
    if (bucket < 92) return 'LATE';
    return 'ABSENT';
  }

  const sectionEnrollmentMap = new Map<string, string[]>(); // section key → admissionNos
  for (const spec of enrollmentSpecs) {
    for (const key of spec.sections) {
      const list = sectionEnrollmentMap.get(key) ?? [];
      list.push(spec.admissionNo);
      sectionEnrollmentMap.set(key, list);
    }
  }

  for (const spec of slotSpecs) {
    const sectionId = sections.get(spec.section)!;
    const slotId = slotIds.get(`${spec.section}/${spec.dayOfWeek}/${spec.startTime}`)!;
    for (const monday of weekMondays) {
      const date = new Date(monday);
      date.setUTCDate(monday.getUTCDate() + spec.dayOfWeek - 1);
      const isPast = date < today;
      const session = await prisma.classSession.upsert({
        where: { slotId_date: { slotId, date } },
        update: {},
        create: {
          slotId,
          sectionId,
          date,
          status: isPast ? 'HELD' : 'SCHEDULED',
          takenById: isPast ? adminUser.id : null,
        },
      });
      if (!isPast) continue;

      const dateKey = date.toISOString().slice(0, 10);
      for (const admissionNo of sectionEnrollmentMap.get(spec.section) ?? []) {
        const studentId = studentProfiles.get(admissionNo)!;
        await prisma.attendanceRecord.upsert({
          where: {
            sessionId_studentId: { sessionId: session.id, studentId },
          },
          update: {},
          create: {
            sessionId: session.id,
            studentId,
            status: statusFor(admissionNo, dateKey),
            markedById: adminUser.id,
          },
        });
      }
    }
  }

  // ── Assignments + submissions (M4) ───────────────────────────
  const teacherUsers = new Map<string, string>(); // employeeNo → userId
  for (const spec of teacherSpecs) {
    const user = await prisma.user.findFirstOrThrow({
      where: { collegeId, email: spec.email },
    });
    teacherUsers.set(spec.employeeNo, user.id);
  }

  const daysFromNow = (days: number, hour = 23) => {
    const date = new Date();
    date.setUTCHours(hour, 59, 0, 0);
    date.setUTCDate(date.getUTCDate() + days);
    return date;
  };

  const assignmentSpecs2: Array<{
    section: string;
    title: string;
    description: string;
    dueInDays: number;
    maxPoints: number;
    allowLate: boolean;
    published: boolean;
    createdBy: string; // employeeNo
    submissions: Array<{
      admissionNo: string;
      text: string;
      daysAgo: number; // submittedAt relative to now
      points?: number;
      feedback?: string;
    }>;
  }> = [
    {
      section: 'CS-101/A',
      title: 'Programming Basics Worksheet',
      description:
        'Complete the ten exercises on variables, conditionals and loops. Submit your answers as text or attach a single file.',
      dueInDays: -3,
      maxPoints: 20,
      allowLate: true,
      published: true,
      createdBy: 'EMP-1001',
      submissions: [
        {
          admissionNo: 'ADM-2026-0001',
          text: 'Answers 1–10 attached inline. Q7 assumes zero-based indexing.',
          daysAgo: 5,
          points: 18,
          feedback: 'Clean work — watch the off-by-one in Q7.',
        },
        {
          admissionNo: 'ADM-2026-0002',
          text: 'Completed all exercises; unsure about Q9 edge case.',
          daysAgo: 4,
          points: 15,
          feedback: 'Q9 needed the empty-input case handled.',
        },
        {
          admissionNo: 'ADM-2026-0003',
          text: 'Submission for worksheet — see answers below. 1) x=5 ...',
          daysAgo: 4,
        },
        {
          admissionNo: 'ADM-2026-0008',
          text: 'Late submission, apologies — full answers included.',
          daysAgo: 1,
        },
      ],
    },
    {
      section: 'CS-201/A',
      title: 'Algorithm Analysis Essay',
      description:
        'Write a 800–1200 word analysis comparing the time and space complexity of merge sort and quicksort, including best/average/worst cases.',
      dueInDays: 5,
      maxPoints: 50,
      allowLate: false,
      published: true,
      createdBy: 'EMP-1001',
      submissions: [
        {
          admissionNo: 'ADM-2026-0001',
          text: 'Draft essay: Merge sort guarantees O(n log n) across all cases while quicksort…',
          daysAgo: 0,
        },
      ],
    },
    {
      section: 'CS-305/A',
      title: 'ER Diagram — Library System',
      description:
        'Model a lending library: members, catalog items, loans, reservations and fines. Draft — publishing after the lecture.',
      dueInDays: 10,
      maxPoints: 30,
      allowLate: true,
      published: false,
      createdBy: 'EMP-1002',
      submissions: [],
    },
    {
      section: 'HUM-150/A',
      title: 'Reflective Paragraph',
      description:
        'Write one well-structured paragraph (150–200 words) reflecting on your first month at college.',
      dueInDays: 2,
      maxPoints: 10,
      allowLate: true,
      published: true,
      createdBy: 'EMP-1005',
      submissions: [
        {
          admissionNo: 'ADM-2026-0011',
          text: 'My first month at Evergreen has challenged how I plan my time…',
          daysAgo: 1,
          points: 9,
          feedback: 'Strong voice; tighten the closing sentence.',
        },
      ],
    },
  ];

  for (const spec of assignmentSpecs2) {
    const sectionId = sections.get(spec.section)!;
    let assignment = await prisma.assignment.findFirst({
      where: { sectionId, title: spec.title },
    });
    if (!assignment) {
      assignment = await prisma.assignment.create({
        data: {
          sectionId,
          title: spec.title,
          description: spec.description,
          dueAt: daysFromNow(spec.dueInDays),
          maxPoints: spec.maxPoints,
          allowLate: spec.allowLate,
          createdById: teacherUsers.get(spec.createdBy)!,
          publishedAt: spec.published ? daysFromNow(spec.dueInDays - 7, 9) : null,
        },
      });
    }
    for (const submission of spec.submissions) {
      const studentId = studentProfiles.get(submission.admissionNo)!;
      const submittedAt = new Date();
      submittedAt.setUTCDate(submittedAt.getUTCDate() - submission.daysAgo);
      const isLate = submittedAt > assignment.dueAt;
      await prisma.submission.upsert({
        where: {
          assignmentId_studentId: { assignmentId: assignment.id, studentId },
        },
        update: {},
        create: {
          assignmentId: assignment.id,
          studentId,
          textContent: submission.text,
          submittedAt,
          isLate,
          ...(submission.points !== undefined
            ? {
                points: submission.points,
                feedback: submission.feedback,
                gradedById: teacherUsers.get(spec.createdBy)!,
                gradedAt: new Date(),
              }
            : {}),
        },
      });
    }
  }

  // ── Exams & results (M5) ─────────────────────────────────────
  function marksFor(admissionNo: string, paperKey: string, max: number): number {
    let hash = 0;
    const seed = `marks:${admissionNo}:${paperKey}`;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
    }
    // 45%–98% of max, rounded to 0.5
    const fraction = 0.45 + (hash % 54) / 100;
    return Math.round(max * fraction * 2) / 2;
  }

  // Published midterm with papers + locked marks.
  let midterm = await prisma.exam.findFirst({
    where: { collegeId, title: 'Midterm Examination — Fall 2026' },
  });
  if (!midterm) {
    midterm = await prisma.exam.create({
      data: {
        collegeId,
        termId: fall.id,
        title: 'Midterm Examination — Fall 2026',
        type: 'MIDTERM',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        publishedById: adminUser.id,
      },
    });
    const midtermPapers: Array<{ section: string; max: number }> = [
      { section: 'CS-101/A', max: 60 },
      { section: 'CS-201/A', max: 80 },
      { section: 'HUM-150/A', max: 40 },
    ];
    for (const paperSpec of midtermPapers) {
      const paper = await prisma.examPaper.create({
        data: {
          examId: midterm.id,
          sectionId: sections.get(paperSpec.section)!,
          examDate: daysFromNow(-10, 9),
          maxMarks: paperSpec.max,
        },
      });
      for (const admissionNo of sectionEnrollmentMap.get(paperSpec.section) ?? []) {
        await prisma.mark.create({
          data: {
            examPaperId: paper.id,
            studentId: studentProfiles.get(admissionNo)!,
            marksObtained: marksFor(admissionNo, paperSpec.section, paperSpec.max),
            enteredById: adminUser.id,
            lockedAt: new Date(),
          },
        });
      }
    }
  }

  // Draft final with one paper, no marks yet.
  let finalExam = await prisma.exam.findFirst({
    where: { collegeId, title: 'Final Examination — Fall 2026' },
  });
  if (!finalExam) {
    finalExam = await prisma.exam.create({
      data: {
        collegeId,
        termId: fall.id,
        title: 'Final Examination — Fall 2026',
        type: 'FINAL',
        status: 'DRAFT',
      },
    });
    await prisma.examPaper.create({
      data: {
        examId: finalExam.id,
        sectionId: sections.get('CS-101/A')!,
        examDate: daysFromNow(30, 9),
        maxMarks: 100,
      },
    });
  }
}
