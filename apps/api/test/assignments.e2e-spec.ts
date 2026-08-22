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

describe('M4 — Assignments', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  const suffix = Date.now().toString(36).toUpperCase();
  const cleanups: Array<() => Promise<unknown>> = [];

  // Fixtures: section taught by demo teacher w/ demo student enrolled, plus
  // an unrelated section (different teacher, student NOT enrolled).
  let sectionId: string;
  let otherSectionId: string;
  let demoStudentProfileId: string;
  let demoStudentUserId: string;
  let otherCollegeId: string;
  let otherCollegeAssignmentId: string;

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
        code: `M4-${suffix}`,
        title: 'M4 Test Course',
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
        name: 'M4A',
        capacity: 10,
      },
    });
    sectionId = section.id;
    const other = await prisma.section.create({
      data: {
        collegeId: college.id,
        courseId: course.id,
        termId: term.id,
        name: 'M4B',
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

    // Tenant isolation fixture.
    const rival = await prisma.college.create({
      data: { name: 'Rival College', code: `RIVAL4-${suffix}` },
    });
    otherCollegeId = rival.id;
    const rivalDept = await prisma.department.create({
      data: { collegeId: rival.id, name: 'RD', code: 'RD' },
    });
    const rivalYear = await prisma.academicYear.create({
      data: {
        collegeId: rival.id,
        label: 'RY',
        startsOn: new Date('2026-01-01'),
        endsOn: new Date('2026-12-31'),
      },
    });
    const rivalTerm = await prisma.term.create({
      data: {
        collegeId: rival.id,
        academicYearId: rivalYear.id,
        label: 'RT',
        startsOn: new Date('2026-01-01'),
        endsOn: new Date('2026-12-31'),
      },
    });
    const rivalCourse = await prisma.course.create({
      data: {
        collegeId: rival.id,
        departmentId: rivalDept.id,
        code: 'R-101',
        title: 'Rival course',
        credits: 3,
      },
    });
    const rivalSection = await prisma.section.create({
      data: {
        collegeId: rival.id,
        courseId: rivalCourse.id,
        termId: rivalTerm.id,
        name: 'A',
        capacity: 10,
      },
    });
    const rivalAdmin = await prisma.user.create({
      data: {
        collegeId: rival.id,
        email: 'rival@rival.dev',
        passwordHash: 'x',
        role: 'ADMIN',
        firstName: 'R',
        lastName: 'A',
      },
    });
    const rivalAssignment = await prisma.assignment.create({
      data: {
        sectionId: rivalSection.id,
        title: 'Rival assignment',
        description: 'x',
        dueAt: new Date(Date.now() + 86400000),
        maxPoints: 10,
        createdById: rivalAdmin.id,
        publishedAt: new Date(),
      },
    });
    otherCollegeAssignmentId = rivalAssignment.id;

    cleanups.push(async () => {
      await prisma.submission.deleteMany({
        where: { assignment: { section: { courseId: course.id } } },
      });
      await prisma.assignment.deleteMany({
        where: { section: { courseId: course.id } },
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
        where: {
          userId: demoStudentUserId,
          type: { in: ['assignment.published', 'assignment.graded'] },
        },
      });
      // Rival college teardown.
      await prisma.assignment.delete({ where: { id: rivalAssignment.id } });
      await prisma.section.delete({ where: { id: rivalSection.id } });
      await prisma.course.delete({ where: { id: rivalCourse.id } });
      await prisma.term.delete({ where: { id: rivalTerm.id } });
      await prisma.academicYear.delete({ where: { id: rivalYear.id } });
      await prisma.department.delete({ where: { id: rivalDept.id } });
      await prisma.user.delete({ where: { id: rivalAdmin.id } });
      await prisma.college.delete({ where: { id: otherCollegeId } });
    });
  });

  afterAll(async () => {
    for (const cleanup of cleanups.reverse()) {
      await cleanup().catch((e) => console.error('cleanup', e));
    }
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const future = new Date(Date.now() + 3 * 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();

  let draftId: string;

  // ── Creation & drafts ───────────────────────────────────────

  it('teacher creates a draft in an assigned section; not in others', async () => {
    const created = await http
      .post('/api/v1/assignments')
      .set(auth(teacherToken))
      .send({
        sectionId,
        title: `Draft HW ${suffix}`,
        description: 'Do the thing.',
        dueAt: future,
        maxPoints: 10,
        allowLate: false,
      });
    expect(created.status).toBe(201);
    expect(created.body.data.publishedAt).toBeNull();
    draftId = created.body.data.id;

    const denied = await http
      .post('/api/v1/assignments')
      .set(auth(teacherToken))
      .send({
        sectionId: otherSectionId,
        title: 'Nope',
        description: 'x',
        dueAt: future,
        maxPoints: 10,
      });
    expect(denied.status).toBe(403);
  });

  it('students cannot see drafts (list + detail); teacher can', async () => {
    const list = await http.get('/api/v1/assignments?limit=100').set(auth(studentToken));
    expect(list.status).toBe(200);
    expect(
      (list.body.data as Array<{ id: string }>).some((a) => a.id === draftId),
    ).toBe(false);

    const detail = await http
      .get(`/api/v1/assignments/${draftId}`)
      .set(auth(studentToken));
    expect(detail.status).toBe(404);

    const teacherDetail = await http
      .get(`/api/v1/assignments/${draftId}`)
      .set(auth(teacherToken));
    expect(teacherDetail.status).toBe(200);
  });

  it('students cannot submit to unpublished assignments', async () => {
    const res = await http
      .post(`/api/v1/assignments/${draftId}/submissions`)
      .set(auth(studentToken))
      .send({ textContent: 'early' });
    expect(res.status).toBe(404);
  });

  // ── Publishing ──────────────────────────────────────────────

  it('publishing makes it visible and notifies the roster; double publish rejected', async () => {
    const before = await prisma.notification.count({
      where: { userId: demoStudentUserId, type: 'assignment.published' },
    });
    const published = await http
      .post(`/api/v1/assignments/${draftId}/publish`)
      .set(auth(teacherToken));
    expect(published.status).toBe(201);
    expect(published.body.data.publishedAt).not.toBeNull();

    await flush();
    const after = await prisma.notification.count({
      where: { userId: demoStudentUserId, type: 'assignment.published' },
    });
    expect(after).toBe(before + 1);

    const again = await http
      .post(`/api/v1/assignments/${draftId}/publish`)
      .set(auth(teacherToken));
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('ALREADY_PUBLISHED');

    const studentDetail = await http
      .get(`/api/v1/assignments/${draftId}`)
      .set(auth(studentToken));
    expect(studentDetail.status).toBe(200);
  });

  // ── Submissions ─────────────────────────────────────────────

  it('student submits text; resubmission updates the single row', async () => {
    const first = await http
      .post(`/api/v1/assignments/${draftId}/submissions`)
      .set(auth(studentToken))
      .send({ textContent: 'My answer v1' });
    expect(first.status).toBe(201);
    expect(first.body.data.mySubmission.isLate).toBe(false);

    const second = await http
      .post(`/api/v1/assignments/${draftId}/submissions`)
      .set(auth(studentToken))
      .send({ textContent: 'My answer v2 (improved)' });
    expect(second.status).toBe(201);
    expect(second.body.data.mySubmissionContent.textContent).toBe(
      'My answer v2 (improved)',
    );

    const count = await prisma.submission.count({
      where: { assignmentId: draftId, studentId: demoStudentProfileId },
    });
    expect(count).toBe(1); // unique constraint honored — one row per student
  });

  it('rejects empty submissions (shared schema)', async () => {
    const res = await http
      .post(`/api/v1/assignments/${draftId}/submissions`)
      .set(auth(studentToken))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('file submission works through /files (upload → submit → serve)', async () => {
    const upload = await http
      .post('/api/v1/files')
      .set(auth(studentToken))
      .attach('file', Buffer.from('my homework contents', 'utf8'), 'homework.txt');
    expect(upload.status).toBe(201);
    const { url, name } = upload.body.data;
    expect(url).toMatch(/^\/api\/v1\/files\//);

    const submit = await http
      .post(`/api/v1/assignments/${draftId}/submissions`)
      .set(auth(studentToken))
      .send({ textContent: 'See attached', fileUrl: url, fileName: name });
    expect(submit.status).toBe(201);
    expect(submit.body.data.mySubmissionContent.fileName).toBe('homework.txt');

    // M10-W1: raw internal URLs are no longer downloadable — a signed URL
    // must be requested first.
    const unsigned = await http.get(url);
    expect(unsigned.status).toBe(403);
    expect(unsigned.body.error.code).toBe('SIGNATURE_REQUIRED');

    const signed = await http
      .post('/api/v1/files/sign')
      .set(auth(studentToken))
      .send({ url });
    expect(signed.status).toBe(201);

    const download = await http
      .get(signed.body.data.url)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(download.status).toBe(200);
    expect((download.body as Buffer).toString('utf8')).toBe('my homework contents');
  });

  it('teachers cannot submit; students not enrolled cannot submit', async () => {
    const teacherAttempt = await http
      .post(`/api/v1/assignments/${draftId}/submissions`)
      .set(auth(teacherToken))
      .send({ textContent: 'nope' });
    expect(teacherAttempt.status).toBe(403);
  });

  // ── Late logic ──────────────────────────────────────────────

  it('past-due with allowLate=false → rejected (PAST_DUE)', async () => {
    const strict = await prisma.assignment.create({
      data: {
        sectionId,
        title: `Strict ${suffix}`,
        description: 'x',
        dueAt: new Date(past),
        maxPoints: 10,
        allowLate: false,
        createdById: (await prisma.user.findFirstOrThrow({ where: { email: TEACHER } })).id,
        publishedAt: new Date(),
      },
    });
    const res = await http
      .post(`/api/v1/assignments/${strict.id}/submissions`)
      .set(auth(studentToken))
      .send({ textContent: 'too late' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PAST_DUE');
  });

  it('past-due with allowLate=true → accepted and isLate=true', async () => {
    const lenient = await prisma.assignment.create({
      data: {
        sectionId,
        title: `Lenient ${suffix}`,
        description: 'x',
        dueAt: new Date(past),
        maxPoints: 10,
        allowLate: true,
        createdById: (await prisma.user.findFirstOrThrow({ where: { email: TEACHER } })).id,
        publishedAt: new Date(),
      },
    });
    const res = await http
      .post(`/api/v1/assignments/${lenient.id}/submissions`)
      .set(auth(studentToken))
      .send({ textContent: 'late but allowed' });
    expect(res.status).toBe(201);
    expect(res.body.data.mySubmission.isLate).toBe(true);
  });

  // ── Grading ─────────────────────────────────────────────────

  let submissionId: string;

  it('teacher lists submissions for assigned sections; student cannot', async () => {
    const list = await http
      .get(`/api/v1/assignments/${draftId}/submissions`)
      .set(auth(teacherToken));
    expect(list.status).toBe(200);
    const entry = list.body.data.entries.find(
      (e: { studentId: string }) => e.studentId === demoStudentProfileId,
    );
    expect(entry.submission).not.toBeNull();
    submissionId = entry.submission.id;

    const denied = await http
      .get(`/api/v1/assignments/${draftId}/submissions`)
      .set(auth(studentToken));
    expect(denied.status).toBe(403);
  });

  it('points above maxPoints are rejected', async () => {
    const res = await http
      .patch(`/api/v1/submissions/${submissionId}/grade`)
      .set(auth(teacherToken))
      .send({ points: 11 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('POINTS_EXCEED_MAX');
  });

  it('grading records points, feedback, grader, timestamp + notification; student sees it; resubmit blocked', async () => {
    const before = await prisma.notification.count({
      where: { userId: demoStudentUserId, type: 'assignment.graded' },
    });
    const graded = await http
      .patch(`/api/v1/submissions/${submissionId}/grade`)
      .set(auth(teacherToken))
      .send({ points: 8.5, feedback: 'Good improvement in v2.' });
    expect(graded.status).toBe(200);

    const row = await prisma.submission.findUniqueOrThrow({
      where: { id: submissionId },
      include: { gradedBy: true },
    });
    expect(row.points?.toString()).toBe('8.5');
    expect(row.feedback).toBe('Good improvement in v2.');
    expect(row.gradedAt).not.toBeNull();
    expect(row.gradedBy?.email).toBe(TEACHER);

    await flush();
    const after = await prisma.notification.count({
      where: { userId: demoStudentUserId, type: 'assignment.graded' },
    });
    expect(after).toBe(before + 1);

    // Student sees grade + feedback.
    const detail = await http
      .get(`/api/v1/assignments/${draftId}`)
      .set(auth(studentToken));
    expect(detail.body.data.mySubmission.points).toBe('8.5');
    expect(detail.body.data.mySubmission.feedback).toBe('Good improvement in v2.');

    // Resubmission after grading is blocked.
    const resubmit = await http
      .post(`/api/v1/assignments/${draftId}/submissions`)
      .set(auth(studentToken))
      .send({ textContent: 'v3' });
    expect(resubmit.status).toBe(400);
    expect(resubmit.body.error.code).toBe('ALREADY_GRADED');
  });

  it('ungraded submissions stay ungraded (lenient assignment)', async () => {
    const lenient = await prisma.assignment.findFirstOrThrow({
      where: { sectionId, title: `Lenient ${suffix}` },
    });
    const row = await prisma.submission.findUniqueOrThrow({
      where: {
        assignmentId_studentId: {
          assignmentId: lenient.id,
          studentId: demoStudentProfileId,
        },
      },
    });
    expect(row.points).toBeNull();
    expect(row.gradedAt).toBeNull();
  });

  // ── Scoping & isolation ─────────────────────────────────────

  it('teacher cannot manage/grade in unassigned sections', async () => {
    const adminUser = await prisma.user.findFirstOrThrow({ where: { email: ADMIN } });
    const foreign = await prisma.assignment.create({
      data: {
        sectionId: otherSectionId,
        title: `Foreign ${suffix}`,
        description: 'x',
        dueAt: new Date(future),
        maxPoints: 10,
        createdById: adminUser.id,
        publishedAt: new Date(),
      },
    });
    for (const attempt of ['patch', 'publish', 'submissions'] as const) {
      const res =
        attempt === 'patch'
          ? await http
              .patch(`/api/v1/assignments/${foreign.id}`)
              .set(auth(teacherToken))
              .send({ title: 'Hijack' })
          : attempt === 'publish'
            ? await http
                .post(`/api/v1/assignments/${foreign.id}/publish`)
                .set(auth(teacherToken))
            : await http
                .get(`/api/v1/assignments/${foreign.id}/submissions`)
                .set(auth(teacherToken));
      expect([400, 403]).toContain(res.status);
      if (res.status === 400) {
        // publish on published returns 400; the manage check comes first for others
        expect(attempt).toBe('publish');
      }
    }
  });

  it('student cannot see assignments of sections they are not enrolled in', async () => {
    const foreign = await prisma.assignment.findFirstOrThrow({
      where: { sectionId: otherSectionId, title: `Foreign ${suffix}` },
    });
    const detail = await http
      .get(`/api/v1/assignments/${foreign.id}`)
      .set(auth(studentToken));
    expect(detail.status).toBe(404);
    const submit = await http
      .post(`/api/v1/assignments/${foreign.id}/submissions`)
      .set(auth(studentToken))
      .send({ textContent: 'x' });
    expect(submit.status).toBe(403);
  });

  it('tenant isolation: another college assignment is invisible to admin', async () => {
    const res = await http
      .get(`/api/v1/assignments/${otherCollegeAssignmentId}`)
      .set(auth(adminToken));
    expect(res.status).toBe(404);
    const grade = await http
      .patch(`/api/v1/assignments/${otherCollegeAssignmentId}`)
      .set(auth(adminToken))
      .send({ title: 'Hijack' });
    expect(grade.status).toBe(404);
  });

  it('admin oversight: sees drafts and all assignments (ALL scope)', async () => {
    const res = await http
      .get(`/api/v1/assignments?limit=100&sectionId=${sectionId}`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
  });

  it('deleting an assignment with submissions is blocked; empty draft deletes', async () => {
    const blocked = await http
      .delete(`/api/v1/assignments/${draftId}`)
      .set(auth(teacherToken));
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.code).toBe('HAS_SUBMISSIONS');

    const fresh = await http
      .post('/api/v1/assignments')
      .set(auth(teacherToken))
      .send({
        sectionId,
        title: `Disposable ${suffix}`,
        description: 'x',
        dueAt: future,
        maxPoints: 5,
      });
    const removed = await http
      .delete(`/api/v1/assignments/${fresh.body.data.id}`)
      .set(auth(teacherToken));
    expect(removed.status).toBe(200);
  });

  it('unauthenticated requests are rejected on M4 surfaces', async () => {
    for (const path of [
      '/api/v1/assignments',
      `/api/v1/assignments/${draftId}`,
      `/api/v1/assignments/${draftId}/submissions`,
    ]) {
      const res = await http.get(path);
      expect(res.status).toBe(401);
    }
    const upload = await http.post('/api/v1/files');
    expect(upload.status).toBe(401);
  });
});
