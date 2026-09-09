import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';
const ADMIN = 'admin@campusos.dev';
const TEACHER = 'teacher@campusos.dev';
const STUDENT = 'student@campusos.dev';

describe('M9 — Dashboards & Hardening', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    app.get(LoginRateLimiterService).reset();
    http = request(app.getHttpServer());

    const token = async (email: string) => {
      const res = await http
        .post('/api/v1/auth/login')
        .send({ email, password: DEMO_PASSWORD });
      expect(res.status).toBe(200);
      return res.body.data.accessToken as string;
    };
    adminToken = await token(ADMIN);
    teacherToken = await token(TEACHER);
    studentToken = await token(STUDENT);
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('admin dashboard aggregates match the database', async () => {
    const res = await http.get('/api/v1/dashboards/admin').set(auth(adminToken));
    expect(res.status).toBe(200);
    const data = res.body.data;

    const college = await prisma.college.findFirstOrThrow({
      where: { code: 'CAMPUS-01' },
    });
    const [students, teachers, sections, openReports] = await Promise.all([
      prisma.studentProfile.count({ where: { collegeId: college.id } }),
      prisma.teacherProfile.count({ where: { collegeId: college.id } }),
      prisma.section.count({ where: { collegeId: college.id } }),
      prisma.report.count({
        where: { collegeId: college.id, status: { in: ['OPEN', 'REVIEWING'] } },
      }),
    ]);
    expect(data.students).toBe(students);
    expect(data.teachers).toBe(teachers);
    expect(data.sections).toBe(sections);
    expect(data.openReports).toBe(openReports);
    expect(Number(data.fees.outstanding)).toBe(
      Number(data.fees.invoiced) - Number(data.fees.collected),
    );
    expect(data.attendanceRate === null || typeof data.attendanceRate === 'number').toBe(true);
    expect(data.currentTermLabel).toBe('Fall 2026');
  });

  it('teacher dashboard reflects assigned sections and grading backlog', async () => {
    const res = await http.get('/api/v1/dashboards/teacher').set(auth(teacherToken));
    expect(res.status).toBe(200);
    const data = res.body.data;

    const sectionIds = (
      await prisma.teachingAssignment.findMany({
        where: { teacher: { user: { email: TEACHER } } },
        select: { sectionId: true },
      })
    ).map((a) => a.sectionId);
    expect(data.sections).toBe(sectionIds.length);

    const pending = await prisma.submission.count({
      where: { assignment: { sectionId: { in: sectionIds } }, points: null },
    });
    expect(data.pendingGrading).toBe(pending);
    expect(Array.isArray(data.todaySessions)).toBe(true);
  });

  it('student dashboard reflects own enrollments, fees and pending work', async () => {
    const res = await http.get('/api/v1/dashboards/student').set(auth(studentToken));
    expect(res.status).toBe(200);
    const data = res.body.data;

    const profile = await prisma.studentProfile.findFirstOrThrow({
      where: { user: { email: STUDENT } },
    });
    const sections = await prisma.enrollment.count({
      where: { studentId: profile.id, status: 'ACTIVE' },
    });
    expect(data.sections).toBe(sections);

    const publishedResults = await prisma.mark.count({
      where: { studentId: profile.id, examPaper: { exam: { status: 'PUBLISHED' } } },
    });
    expect(data.publishedResults).toBe(publishedResults);

    // Pending assignments never include ones already submitted.
    for (const assignment of data.pendingAssignments) {
      const submitted = await prisma.submission.findFirst({
        where: { assignmentId: assignment.id, studentId: profile.id },
      });
      expect(submitted).toBeNull();
    }
    expect(Number.isNaN(Number(data.feeBalance))).toBe(false);
  });

  it('dashboards enforce role permissions (matrix, not role checks)', async () => {
    const denials: Array<[string, string]> = [
      ['/api/v1/dashboards/admin', teacherToken],
      ['/api/v1/dashboards/admin', studentToken],
      ['/api/v1/dashboards/teacher', studentToken],
      ['/api/v1/dashboards/student', teacherToken],
      ['/api/v1/dashboards/teacher', adminToken],
    ];
    for (const [path, token] of denials) {
      const res = await http.get(path).set(auth(token));
      expect(res.status).toBe(403);
    }
  });

  it('unauthenticated requests are rejected on dashboards', async () => {
    for (const path of [
      '/api/v1/dashboards/admin',
      '/api/v1/dashboards/teacher',
      '/api/v1/dashboards/student',
    ]) {
      const res = await http.get(path);
      expect(res.status).toBe(401);
    }
  });

  it('regression: health endpoint still reports database up', async () => {
    const res = await http.get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.data.database).toBe('up');
  });
});
