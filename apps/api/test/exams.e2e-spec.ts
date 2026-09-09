import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';
const ADMIN = 'admin@campusos.dev';
const TEACHER = 'teacher@campusos.dev';
const STUDENT = 'student@campusos.dev';

const flush = () => new Promise((resolve) => setTimeout(resolve, 300));

describe('M5 — Exams & Results', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  const suffix = Date.now().toString(36).toUpperCase();
  const cleanups: Array<() => Promise<unknown>> = [];

  let sectionId: string; // taught by demo teacher, demo student enrolled
  let otherSectionId: string; // not taught by demo teacher
  let demoStudentProfileId: string;
  let demoStudentUserId: string;
  let examId: string;
  let paperId: string;

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

    const college = await prisma.college.findFirstOrThrow({
      where: { code: 'CAMPUS-01' },
    });
    const term = await prisma.term.findFirstOrThrow({
      where: { collegeId: college.id, isCurrent: true },
    });
    const department = await prisma.department.findFirstOrThrow({
      where: { collegeId: college.id },
    });
    const course = await prisma.course.create({
      data: {
        collegeId: college.id,
        departmentId: department.id,
        code: `M5-${suffix}`,
        title: 'M5 Test Course',
        credits: 3,
      },
    });
    const teacherProfile = await prisma.teacherProfile.findFirstOrThrow({
      where: { user: { email: TEACHER } },
    });
    const studentProfile = await prisma.studentProfile.findFirstOrThrow({
      where: { user: { email: STUDENT } },
    });
    demoStudentProfileId = studentProfile.id;
    demoStudentUserId = studentProfile.userId;

    const section = await prisma.section.create({
      data: {
        collegeId: college.id,
        courseId: course.id,
        termId: term.id,
        name: 'M5A',
        capacity: 10,
      },
    });
    sectionId = section.id;
    const other = await prisma.section.create({
      data: {
        collegeId: college.id,
        courseId: course.id,
        termId: term.id,
        name: 'M5B',
        capacity: 10,
      },
    });
    otherSectionId = other.id;
    await prisma.teachingAssignment.create({
      data: { teacherId: teacherProfile.id, sectionId, isPrimary: true },
    });
    await prisma.enrollment.create({
      data: { studentId: demoStudentProfileId, sectionId },
    });

    cleanups.push(async () => {
      await prisma.mark.deleteMany({
        where: { examPaper: { section: { courseId: course.id } } },
      });
      await prisma.examPaper.deleteMany({
        where: { section: { courseId: course.id } },
      });
      await prisma.exam.deleteMany({
        where: { collegeId: college.id, title: { contains: suffix } },
      });
      await prisma.enrollment.deleteMany({
        where: { sectionId: { in: [sectionId, otherSectionId] } },
      });
      await prisma.teachingAssignment.deleteMany({
        where: { sectionId: { in: [sectionId, otherSectionId] } },
      });
      await prisma.section.deleteMany({
        where: { id: { in: [sectionId, otherSectionId] } },
      });
      await prisma.course.delete({ where: { id: course.id } });
      await prisma.notification.deleteMany({
        where: { userId: demoStudentUserId, type: 'results.published' },
      });
    });
  });

  afterAll(async () => {
    for (const cleanup of cleanups.reverse()) {
      await cleanup().catch(() => undefined);
    }
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  // ── Exam & paper management ─────────────────────────────────

  it('admin creates an exam; teacher and student cannot', async () => {
    const term = await prisma.term.findFirstOrThrow({ where: { isCurrent: true } });
    const created = await http
      .post('/api/v1/exams')
      .set(auth(adminToken))
      .send({ termId: term.id, title: `Test Exam ${suffix}`, type: 'QUIZ' });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('DRAFT');
    examId = created.body.data.id;

    for (const t of [teacherToken, studentToken]) {
      const denied = await http
        .post('/api/v1/exams')
        .set(auth(t))
        .send({ termId: term.id, title: 'Nope', type: 'QUIZ' });
      expect(denied.status).toBe(403);
    }
  });

  it('papers validate section/term and uniqueness', async () => {
    const good = await http
      .post(`/api/v1/exams/${examId}/papers`)
      .set(auth(adminToken))
      .send({
        sectionId,
        examDate: new Date().toISOString(),
        maxMarks: 50,
      });
    expect(good.status).toBe(201);
    paperId = good.body.data.id;

    const dup = await http
      .post(`/api/v1/exams/${examId}/papers`)
      .set(auth(adminToken))
      .send({ sectionId, examDate: new Date().toISOString(), maxMarks: 50 });
    expect(dup.status).toBe(400);
    expect(dup.body.error.code).toBe('DUPLICATE_PAPER');

    // Section from a different term is rejected.
    const springTerm = await prisma.term.findFirstOrThrow({
      where: { isCurrent: false, label: 'Spring 2027' },
    });
    const otherCourse = await prisma.course.findFirstOrThrow({
      where: { code: `M5-${suffix}` },
    });
    const springSection = await prisma.section.create({
      data: {
        collegeId: otherCourse.collegeId,
        courseId: otherCourse.id,
        termId: springTerm.id,
        name: 'SPR',
        capacity: 5,
      },
    });
    cleanups.push(() =>
      prisma.section.delete({ where: { id: springSection.id } }),
    );
    const mismatch = await http
      .post(`/api/v1/exams/${examId}/papers`)
      .set(auth(adminToken))
      .send({
        sectionId: springSection.id,
        examDate: new Date().toISOString(),
        maxMarks: 50,
      });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.code).toBe('TERM_MISMATCH');
  });

  // ── Marks entry ─────────────────────────────────────────────

  it('teacher enters marks for an assigned paper; range and enrollment validated', async () => {
    const overMax = await http
      .put(`/api/v1/papers/${paperId}/marks`)
      .set(auth(teacherToken))
      .send({ marks: [{ studentId: demoStudentProfileId, marksObtained: 51 }] });
    expect(overMax.status).toBe(400);
    expect(overMax.body.error.code).toBe('MARKS_EXCEED_MAX');

    const stranger = await prisma.studentProfile.findFirstOrThrow({
      where: { id: { not: demoStudentProfileId } },
    });
    const notEnrolled = await http
      .put(`/api/v1/papers/${paperId}/marks`)
      .set(auth(teacherToken))
      .send({ marks: [{ studentId: stranger.id, marksObtained: 10 }] });
    expect(notEnrolled.status).toBe(400);
    expect(notEnrolled.body.error.code).toBe('NOT_ENROLLED');

    const saved = await http
      .put(`/api/v1/papers/${paperId}/marks`)
      .set(auth(teacherToken))
      .send({ marks: [{ studentId: demoStudentProfileId, marksObtained: 42 }] });
    expect(saved.status).toBe(200);
    expect(saved.body.data.entries[0].marksObtained).toBe('42');

    // Update (upsert) works pre-publish.
    const updated = await http
      .put(`/api/v1/papers/${paperId}/marks`)
      .set(auth(teacherToken))
      .send({ marks: [{ studentId: demoStudentProfileId, marksObtained: 44 }] });
    expect(updated.status).toBe(200);
    expect(updated.body.data.entries[0].marksObtained).toBe('44');
  });

  it('teacher cannot enter marks for unassigned papers; student cannot at all', async () => {
    const foreignPaper = await http
      .post(`/api/v1/exams/${examId}/papers`)
      .set(auth(adminToken))
      .send({
        sectionId: otherSectionId,
        examDate: new Date().toISOString(),
        maxMarks: 50,
      });
    expect(foreignPaper.status).toBe(201);

    const denied = await http
      .put(`/api/v1/papers/${foreignPaper.body.data.id}/marks`)
      .set(auth(teacherToken))
      .send({ marks: [{ studentId: demoStudentProfileId, marksObtained: 1 }] });
    expect(denied.status).toBe(403);

    const student = await http
      .put(`/api/v1/papers/${paperId}/marks`)
      .set(auth(studentToken))
      .send({ marks: [{ studentId: demoStudentProfileId, marksObtained: 50 }] });
    expect(student.status).toBe(403);
  });

  // ── Results visibility pre-publish ──────────────────────────

  it('students see no unpublished results', async () => {
    const res = await http.get('/api/v1/results').set(auth(studentToken));
    expect(res.status).toBe(200);
    expect(
      (res.body.data.rows as Array<{ examId: string }>).some(
        (row) => row.examId === examId,
      ),
    ).toBe(false);
  });

  // ── Publish ─────────────────────────────────────────────────

  it('publish is admin-only, atomic, locks marks and notifies marked students', async () => {
    const teacherDenied = await http
      .post(`/api/v1/exams/${examId}/publish`)
      .set(auth(teacherToken));
    expect(teacherDenied.status).toBe(403);

    const before = await prisma.notification.count({
      where: { userId: demoStudentUserId, type: 'results.published' },
    });

    const published = await http
      .post(`/api/v1/exams/${examId}/publish`)
      .set(auth(adminToken));
    expect(published.status).toBe(201);
    expect(published.body.data.status).toBe('PUBLISHED');

    // Marks locked.
    const mark = await prisma.mark.findFirstOrThrow({
      where: { examPaperId: paperId, studentId: demoStudentProfileId },
    });
    expect(mark.lockedAt).not.toBeNull();

    // Further mark entry is rejected.
    const lockedWrite = await http
      .put(`/api/v1/papers/${paperId}/marks`)
      .set(auth(teacherToken))
      .send({ marks: [{ studentId: demoStudentProfileId, marksObtained: 45 }] });
    expect(lockedWrite.status).toBe(400);
    expect(lockedWrite.body.error.code).toBe('MARKS_LOCKED');

    // Exam metadata locked.
    const patch = await http
      .patch(`/api/v1/exams/${examId}`)
      .set(auth(adminToken))
      .send({ title: 'Renamed' });
    expect(patch.status).toBe(400);
    expect(patch.body.error.code).toBe('EXAM_PUBLISHED');

    // Double publish rejected.
    const again = await http
      .post(`/api/v1/exams/${examId}/publish`)
      .set(auth(adminToken));
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('ALREADY_PUBLISHED');

    await flush();
    const after = await prisma.notification.count({
      where: { userId: demoStudentUserId, type: 'results.published' },
    });
    expect(after).toBe(before + 1);
  });

  // ── Results after publish ───────────────────────────────────

  it('student sees published results with correct percentage and grade band', async () => {
    const res = await http.get('/api/v1/results').set(auth(studentToken));
    expect(res.status).toBe(200);
    const row = (res.body.data.rows as Array<Record<string, unknown>>).find(
      (r) => r.examId === examId,
    );
    expect(row).toBeDefined();
    expect(row!.marksObtained).toBe('44');
    expect(row!.maxMarks).toBe('50');
    expect(row!.percentage).toBe(88); // 44/50
    expect(row!.bandLabel).toBe('A'); // 80–89.99 per seeded bands
    expect(res.body.data.overall.percentage).not.toBeNull();
  });

  it('teacher reads results of assigned students only; admin reads any', async () => {
    const ok = await http
      .get(`/api/v1/results?studentId=${demoStudentProfileId}`)
      .set(auth(teacherToken));
    expect(ok.status).toBe(200);

    // A student in no section of the demo teacher.
    const unrelated = await prisma.studentProfile.findFirstOrThrow({
      where: {
        enrollments: {
          none: {
            section: {
              teachingAssignments: { some: { teacher: { user: { email: TEACHER } } } },
            },
          },
        },
      },
    });
    const denied = await http
      .get(`/api/v1/results?studentId=${unrelated.id}`)
      .set(auth(teacherToken));
    expect(denied.status).toBe(403);

    const adminOk = await http
      .get(`/api/v1/results?studentId=${unrelated.id}`)
      .set(auth(adminToken));
    expect(adminOk.status).toBe(200);
  });

  it('students cannot read another student\'s results (OWN forces self)', async () => {
    const other = await prisma.studentProfile.findFirstOrThrow({
      where: { id: { not: demoStudentProfileId } },
    });
    const res = await http
      .get(`/api/v1/results?studentId=${other.id}`)
      .set(auth(studentToken));
    expect(res.status).toBe(200);
    // OWN scope ignores the studentId parameter and returns self.
    expect(res.body.data.studentId).toBe(demoStudentProfileId);
  });

  // ── Analytics & grade bands ─────────────────────────────────

  it('analytics is admin-only and aggregates paper stats + band distribution', async () => {
    const denied = await http
      .get(`/api/v1/results/analytics?examId=${examId}`)
      .set(auth(teacherToken));
    expect(denied.status).toBe(403);

    const res = await http
      .get(`/api/v1/results/analytics?examId=${examId}`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    const paper = res.body.data.papers.find(
      (p: { paperId: string }) => p.paperId === paperId,
    );
    expect(paper.markCount).toBe(1);
    expect(paper.average).toBe(44);
    const aBand = res.body.data.bandDistribution.find(
      (b: { label: string }) => b.label === 'A',
    );
    expect(aBand.count).toBeGreaterThanOrEqual(1);
  });

  it('grade bands: everyone reads, only admin updates; overlaps rejected', async () => {
    const read = await http.get('/api/v1/grade-bands').set(auth(studentToken));
    expect(read.status).toBe(200);
    expect(read.body.data.length).toBeGreaterThanOrEqual(2);

    const denied = await http
      .put('/api/v1/grade-bands')
      .set(auth(teacherToken))
      .send({ bands: [{ label: 'P', minPercent: 50, maxPercent: 100 }, { label: 'F', minPercent: 0, maxPercent: 49.99 }] });
    expect(denied.status).toBe(403);

    const overlap = await http
      .put('/api/v1/grade-bands')
      .set(auth(adminToken))
      .send({
        bands: [
          { label: 'A', minPercent: 50, maxPercent: 100 },
          { label: 'B', minPercent: 40, maxPercent: 60 },
        ],
      });
    expect(overlap.status).toBe(400);
    expect(overlap.body.error.code).toBe('BANDS_OVERLAP');
  });

  // ── Tenant isolation & auth ─────────────────────────────────

  it('tenant isolation: exams in other colleges are invisible', async () => {
    const rival = await prisma.college.create({
      data: { name: 'Rival5', code: `RIVAL5-${suffix}` },
    });
    const rivalYear = await prisma.academicYear.create({
      data: {
        collegeId: rival.id,
        label: 'RY5',
        startsOn: new Date('2026-01-01'),
        endsOn: new Date('2026-12-31'),
      },
    });
    const rivalTerm = await prisma.term.create({
      data: {
        collegeId: rival.id,
        academicYearId: rivalYear.id,
        label: 'RT5',
        startsOn: new Date('2026-01-01'),
        endsOn: new Date('2026-12-31'),
      },
    });
    const rivalExam = await prisma.exam.create({
      data: {
        collegeId: rival.id,
        termId: rivalTerm.id,
        title: 'Rival exam',
        type: 'QUIZ',
      },
    });
    cleanups.push(async () => {
      await prisma.exam.delete({ where: { id: rivalExam.id } });
      await prisma.term.delete({ where: { id: rivalTerm.id } });
      await prisma.academicYear.delete({ where: { id: rivalYear.id } });
      await prisma.college.delete({ where: { id: rival.id } });
    });

    const res = await http
      .get(`/api/v1/exams/${rivalExam.id}`)
      .set(auth(adminToken));
    expect(res.status).toBe(404);
  });

  it('unauthenticated requests are rejected on M5 surfaces', async () => {
    for (const path of [
      '/api/v1/exams',
      '/api/v1/results',
      '/api/v1/grade-bands',
      `/api/v1/papers/${paperId}/marks`,
    ]) {
      const res = await http.get(path);
      expect(res.status).toBe(401);
    }
  });
});
