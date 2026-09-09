import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';
const ADMIN = 'admin@campusos.dev';
const TEACHER = 'teacher@campusos.dev';
const STUDENT = 'student@campusos.dev';

describe('M2 — Academic Core', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  const suffix = Date.now().toString(36).toUpperCase();
  const lsuffix = suffix.toLowerCase();
  const created: Array<() => Promise<unknown>> = []; // LIFO cleanup
  let otherCollegeId: string;
  let otherDepartmentId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    app.get(LoginRateLimiterService).reset();
    http = request(app.getHttpServer());

    async function token(email: string): Promise<string> {
      const res = await http
        .post('/api/v1/auth/login')
        .send({ email, password: DEMO_PASSWORD });
      expect(res.status).toBe(200);
      return res.body.data.accessToken as string;
    }
    adminToken = await token(ADMIN);
    teacherToken = await token(TEACHER);
    studentToken = await token(STUDENT);

    // Second college for tenant-isolation tests.
    const otherCollege = await prisma.college.create({
      data: { name: 'Rival College', code: `RIVAL-${suffix}` },
    });
    otherCollegeId = otherCollege.id;
    const otherDepartment = await prisma.department.create({
      data: { collegeId: otherCollegeId, name: 'Rival CS', code: 'RCS' },
    });
    otherDepartmentId = otherDepartment.id;
    created.push(async () => {
      await prisma.department.delete({ where: { id: otherDepartmentId } });
      await prisma.college.delete({ where: { id: otherCollegeId } });
    });
  });

  afterAll(async () => {
    for (const cleanup of created.reverse()) {
      await cleanup().catch(() => undefined);
    }
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  // ── Admin CRUD across the structure ─────────────────────────

  let departmentId: string;
  let courseId: string;
  let sectionId: string;
  let studentProfileId: string;
  let teacherProfileId: string;

  it('admin creates a department', async () => {
    const res = await http
      .post('/api/v1/departments')
      .set(auth(adminToken))
      .send({ name: `Test Dept ${suffix}`, code: `TD${suffix}` });
    expect(res.status).toBe(201);
    departmentId = res.body.data.id;
    created.push(() => prisma.department.delete({ where: { id: departmentId } }));
  });

  it('rejects duplicate department codes within the college', async () => {
    const res = await http
      .post('/api/v1/departments')
      .set(auth(adminToken))
      .send({ name: 'Dup', code: `TD${suffix}` });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DUPLICATE_DEPARTMENT_CODE');
  });

  it('admin creates a course in the department', async () => {
    const res = await http
      .post('/api/v1/courses')
      .set(auth(adminToken))
      .send({
        departmentId,
        code: `TC-${suffix}`,
        title: 'Test Course',
        credits: 3,
      });
    expect(res.status).toBe(201);
    courseId = res.body.data.id;
    created.push(() => prisma.course.delete({ where: { id: courseId } }));
  });

  it('rejects duplicate course codes within the college', async () => {
    const res = await http
      .post('/api/v1/courses')
      .set(auth(adminToken))
      .send({ departmentId, code: `TC-${suffix}`, title: 'Dup', credits: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DUPLICATE_COURSE_CODE');
  });

  it('rejects courses referencing a department from another college', async () => {
    const res = await http
      .post('/api/v1/courses')
      .set(auth(adminToken))
      .send({
        departmentId: otherDepartmentId,
        code: `XC-${suffix}`,
        title: 'Cross-college',
        credits: 3,
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DEPARTMENT');
  });

  it('admin creates a section (capacity 1 for the capacity test)', async () => {
    const term = await prisma.term.findFirstOrThrow({ where: { isCurrent: true } });
    const res = await http
      .post('/api/v1/sections')
      .set(auth(adminToken))
      .send({ courseId, termId: term.id, name: 'T1', capacity: 1 });
    expect(res.status).toBe(201);
    sectionId = res.body.data.id;
    created.push(async () => {
      await prisma.enrollment.deleteMany({ where: { sectionId } });
      await prisma.teachingAssignment.deleteMany({ where: { sectionId } });
      await prisma.section.delete({ where: { id: sectionId } });
    });
  });

  it('rejects duplicate section names within course + term', async () => {
    const term = await prisma.term.findFirstOrThrow({ where: { isCurrent: true } });
    const res = await http
      .post('/api/v1/sections')
      .set(auth(adminToken))
      .send({ courseId, termId: term.id, name: 'T1', capacity: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DUPLICATE_SECTION_NAME');
  });

  it('rejects non-positive section capacity (shared schema, server side)', async () => {
    const term = await prisma.term.findFirstOrThrow({ where: { isCurrent: true } });
    const res = await http
      .post('/api/v1/sections')
      .set(auth(adminToken))
      .send({ courseId, termId: term.id, name: 'T2', capacity: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('admin creates a student (User + StudentProfile, forced password change)', async () => {
    const res = await http
      .post('/api/v1/students')
      .set(auth(adminToken))
      .send({
        firstName: 'Testy',
        lastName: 'McTest',
        email: `testy-${suffix}@campusos.dev`.toLowerCase(),
        departmentId,
        admissionNo: `ADM-T-${suffix}`,
        rollNo: `TR-${suffix}`,
        batch: '2026',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.tempPassword).toBeUndefined();
    expect(res.body.data.invite.url).toMatch(/^\/accept-invite\?token=[0-9a-f]{64}$/);
    expect(res.body.data.invite.expiresAt).toBeDefined();
    studentProfileId = res.body.data.student.id;
    const user = await prisma.user.findFirstOrThrow({
      where: { email: `testy-${suffix}@campusos.dev`.toLowerCase() },
    });
    expect(user.mustChangePassword).toBe(true);
    created.push(async () => {
      await prisma.enrollment.deleteMany({ where: { studentId: studentProfileId } });
      await prisma.studentProfile.delete({ where: { id: studentProfileId } });
      await prisma.auditLog.deleteMany({ where: { actorId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    });
  });

  it('rejects duplicate admission numbers within the college', async () => {
    const res = await http
      .post('/api/v1/students')
      .set(auth(adminToken))
      .send({
        firstName: 'Dup',
        lastName: 'Student',
        email: `dup-${suffix}@campusos.dev`,
        departmentId,
        admissionNo: `ADM-T-${suffix}`,
        rollNo: 'X',
        batch: '2026',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DUPLICATE_ADMISSION_NO');
  });

  it('admin creates a teacher and duplicate employee numbers are rejected', async () => {
    const createRes = await http
      .post('/api/v1/teachers')
      .set(auth(adminToken))
      .send({
        firstName: 'Prof',
        lastName: 'Test',
        email: `prof-${suffix}@campusos.dev`.toLowerCase(),
        departmentId,
        employeeNo: `EMP-T-${suffix}`,
        designation: 'Lecturer',
        joinedOn: '2024-01-01',
      });
    expect(createRes.status).toBe(201);
    teacherProfileId = createRes.body.data.teacher.id;
    const user = await prisma.user.findFirstOrThrow({
      where: { email: `prof-${suffix}@campusos.dev`.toLowerCase() },
    });
    created.push(async () => {
      await prisma.teachingAssignment.deleteMany({ where: { teacherId: teacherProfileId } });
      await prisma.teacherProfile.delete({ where: { id: teacherProfileId } });
      await prisma.auditLog.deleteMany({ where: { actorId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    });

    const dupRes = await http
      .post('/api/v1/teachers')
      .set(auth(adminToken))
      .send({
        firstName: 'Dup',
        lastName: 'Prof',
        email: `dupprof-${suffix}@campusos.dev`,
        departmentId,
        employeeNo: `EMP-T-${suffix}`,
        designation: 'Lecturer',
        joinedOn: '2024-01-01',
      });
    expect(dupRes.status).toBe(400);
    expect(dupRes.body.error.code).toBe('DUPLICATE_EMPLOYEE_NO');
  });

  // ── Enrollment & assignment rules ───────────────────────────

  it('enrolls a student; duplicates and capacity overruns are rejected', async () => {
    const enroll = await http
      .post(`/api/v1/sections/${sectionId}/enrollments/${studentProfileId}`)
      .set(auth(adminToken));
    expect(enroll.status).toBe(201);

    const dup = await http
      .post(`/api/v1/sections/${sectionId}/enrollments/${studentProfileId}`)
      .set(auth(adminToken));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_ENROLLED');

    // Capacity is 1 → a second student must be rejected.
    const other = await prisma.studentProfile.findFirstOrThrow({
      where: { user: { email: STUDENT } },
    });
    const full = await http
      .post(`/api/v1/sections/${sectionId}/enrollments/${other.id}`)
      .set(auth(adminToken));
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('SECTION_FULL');
  });

  it('assigns a teacher; duplicate assignment is rejected', async () => {
    const assign = await http
      .post(`/api/v1/sections/${sectionId}/teachers/${teacherProfileId}`)
      .set(auth(adminToken))
      .send({ isPrimary: true });
    expect(assign.status).toBe(201);

    const dup = await http
      .post(`/api/v1/sections/${sectionId}/teachers/${teacherProfileId}`)
      .set(auth(adminToken))
      .send({});
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_ASSIGNED');
  });

  it('section overview returns roster, teachers and (empty) timetable', async () => {
    const res = await http
      .get(`/api/v1/sections/${sectionId}/overview`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.enrolledCount).toBe(1);
    expect(res.body.data.students).toHaveLength(1);
    expect(res.body.data.teachers).toHaveLength(1);
    expect(res.body.data.teachers[0].isPrimary).toBe(true);
    expect(res.body.data.timetableSlots).toEqual([]);
  });

  it('archived courses cannot receive new sections', async () => {
    const archive = await http
      .patch(`/api/v1/courses/${courseId}`)
      .set(auth(adminToken))
      .send({ status: 'ARCHIVED' });
    expect(archive.status).toBe(200);

    const term = await prisma.term.findFirstOrThrow({ where: { isCurrent: true } });
    const res = await http
      .post('/api/v1/sections')
      .set(auth(adminToken))
      .send({ courseId, termId: term.id, name: 'T9', capacity: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('COURSE_ARCHIVED');

    await http
      .patch(`/api/v1/courses/${courseId}`)
      .set(auth(adminToken))
      .send({ status: 'ACTIVE' });
  });

  it('set-current keeps exactly one current term per college', async () => {
    const college = await prisma.college.findFirstOrThrow({
      where: { code: 'CAMPUS-01' },
    });
    const terms = await prisma.term.findMany({ where: { collegeId: college.id } });
    expect(terms.length).toBeGreaterThanOrEqual(2);
    const current = terms.find((t) => t.isCurrent)!;
    const next = terms.find((t) => !t.isCurrent)!;

    const res = await http
      .patch(`/api/v1/terms/${next.id}/set-current`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    const currentCount = await prisma.term.count({
      where: { collegeId: college.id, isCurrent: true },
    });
    expect(currentCount).toBe(1);

    // Restore
    await http.patch(`/api/v1/terms/${current.id}/set-current`).set(auth(adminToken));
  });

  // ── Tenant isolation ────────────────────────────────────────

  it('cross-college rows are invisible and unpatchable (404)', async () => {
    const list = await http.get('/api/v1/departments?limit=100').set(auth(adminToken));
    expect(list.status).toBe(200);
    expect(
      (list.body.data as Array<{ id: string }>).some((d) => d.id === otherDepartmentId),
    ).toBe(false);

    const patch = await http
      .patch(`/api/v1/departments/${otherDepartmentId}`)
      .set(auth(adminToken))
      .send({ name: 'Hijacked' });
    expect(patch.status).toBe(404);
  });

  // ── Role behavior ───────────────────────────────────────────

  it('teacher cannot manage academic structure or people', async () => {
    const dept = await http
      .post('/api/v1/departments')
      .set(auth(teacherToken))
      .send({ name: 'X', code: 'XX' });
    expect(dept.status).toBe(403);
    const student = await http
      .post('/api/v1/students')
      .set(auth(teacherToken))
      .send({});
    expect(student.status).toBe(403);
    const enroll = await http
      .post(`/api/v1/sections/${sectionId}/enrollments/${studentProfileId}`)
      .set(auth(teacherToken));
    expect(enroll.status).toBe(403);
  });

  it('teacher list of students is restricted to ASSIGNED sections', async () => {
    const res = await http.get('/api/v1/students?limit=100').set(auth(teacherToken));
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<{ id: string }>;
    // Demo teacher teaches CS-101/A + CS-201/A; the fresh test student is
    // enrolled only in the test section taught by the fresh test teacher.
    expect(rows.some((row) => row.id === studentProfileId)).toBe(false);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('teacher can read a student in an assigned section, not others', async () => {
    const assigned = await prisma.studentProfile.findFirstOrThrow({
      where: {
        enrollments: {
          some: {
            status: 'ACTIVE',
            section: {
              teachingAssignments: {
                some: { teacher: { user: { email: TEACHER } } },
              },
            },
          },
        },
      },
    });
    const ok = await http
      .get(`/api/v1/students/${assigned.id}`)
      .set(auth(teacherToken));
    expect(ok.status).toBe(200);

    const denied = await http
      .get(`/api/v1/students/${studentProfileId}`)
      .set(auth(teacherToken));
    expect(denied.status).toBe(403);
  });

  it('student sees only self in the students list (OWN scope)', async () => {
    const res = await http.get('/api/v1/students?limit=100').set(auth(studentToken));
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<{ email: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(STUDENT);
  });

  it('student cannot read another student profile or manage anything', async () => {
    const other = await http
      .get(`/api/v1/students/${studentProfileId}`)
      .set(auth(studentToken));
    expect(other.status).toBe(403);

    for (const path of [
      '/api/v1/departments',
      '/api/v1/courses',
      '/api/v1/sections',
      '/api/v1/teachers',
    ]) {
      const res = await http.post(path).set(auth(studentToken)).send({});
      expect(res.status).toBe(403);
    }
  });

  it('student sections/courses lists are OWN-scoped (enrolled only)', async () => {
    const sectionsRes = await http.get('/api/v1/sections?limit=100').set(auth(studentToken));
    expect(sectionsRes.status).toBe(200);
    const own = await prisma.enrollment.count({
      where: { student: { user: { email: STUDENT } }, status: 'ACTIVE' },
    });
    expect((sectionsRes.body.data as unknown[]).length).toBe(own);

    // The fresh test section (not enrolled) must be invisible in detail too.
    const denied = await http
      .get(`/api/v1/sections/${sectionId}/overview`)
      .set(auth(studentToken));
    expect(denied.status).toBe(404);
  });

  // ── CSV import ──────────────────────────────────────────────

  it('CSV import creates valid rows, reports row-level errors, never partial-creates', async () => {
    const csv = [
      'firstName,lastName,email,admissionNo,rollNo,batch,departmentCode',
      `Ana,Lopez,ana-${lsuffix}@campusos.dev,ADM-I1-${suffix},IR-1,2026,TD${suffix}`,
      `Bad,Email,not-an-email,ADM-I2-${suffix},IR-2,2026,TD${suffix}`,
      `Bo,Zhang,bo-${lsuffix}@campusos.dev,ADM-I3-${suffix},IR-3,2026,NOPE`,
      `Cara,Diaz,cara-${lsuffix}@campusos.dev,ADM-I1-${suffix},IR-4,2026,TD${suffix}`, // dup within file
    ].join('\n');

    const res = await http
      .post('/api/v1/students/import')
      .set(auth(adminToken))
      .attach('file', Buffer.from(csv, 'utf8'), 'students.csv');
    expect(res.status).toBe(201);
    const summary = res.body.data;
    expect(summary.created).toBe(1);
    expect(summary.failed).toBe(3);
    expect(summary.errors).toHaveLength(3);
    expect(summary.createdStudents[0].email).toBe(`ana-${lsuffix}@campusos.dev`);
    expect(summary.createdStudents[0].tempPassword).toBeUndefined();
    expect(summary.createdStudents[0].inviteUrl).toMatch(
      /^\/accept-invite\?token=[0-9a-f]{64}$/,
    );
    expect(summary.createdStudents[0].inviteExpiresAt).toBeDefined();

    const anaUser = await prisma.user.findFirstOrThrow({
      where: { email: `ana-${lsuffix}@campusos.dev` },
      include: { studentProfile: true },
    });
    expect(anaUser.mustChangePassword).toBe(true);
    expect(anaUser.studentProfile).not.toBeNull();
    // Failed rows created nothing.
    expect(
      await prisma.user.count({ where: { email: `bo-${lsuffix}@campusos.dev` } }),
    ).toBe(0);
    expect(
      await prisma.user.count({ where: { email: `cara-${lsuffix}@campusos.dev` } }),
    ).toBe(0);

    created.push(async () => {
      await prisma.studentProfile.delete({ where: { userId: anaUser.id } });
      await prisma.user.delete({ where: { id: anaUser.id } });
    });

    // Students cannot import.
    const forbidden = await http
      .post('/api/v1/students/import')
      .set(auth(studentToken))
      .attach('file', Buffer.from(csv, 'utf8'), 'students.csv');
    expect(forbidden.status).toBe(403);
  });

  // ── Regression guards ───────────────────────────────────────

  it('unauthenticated requests are rejected on every M2 surface', async () => {
    for (const path of [
      '/api/v1/students',
      '/api/v1/teachers',
      '/api/v1/departments',
      '/api/v1/courses',
      '/api/v1/sections',
      '/api/v1/terms',
      '/api/v1/academic-years',
    ]) {
      const res = await http.get(path);
      expect(res.status).toBe(401);
    }
  });
});
