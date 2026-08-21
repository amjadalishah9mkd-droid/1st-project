import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';
const ADMIN = 'admin@campusos.dev';
const TEACHER = 'teacher@campusos.dev';
const STUDENT = 'student@campusos.dev';

/** Waits for async event listeners to flush. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 300));

describe('M3 — Timetable & Attendance', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  const suffix = Date.now().toString(36).toUpperCase();
  const cleanups: Array<() => Promise<unknown>> = [];

  // Fixture: fresh course + section taught by demo teacher, with the demo
  // student enrolled, so tests never disturb seeded demo data.
  let sectionId: string;
  let otherSectionId: string; // NOT taught by demo teacher
  let slotId: string;
  let demoStudentProfileId: string;
  let demoStudentUserId: string;

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
        code: `M3-${suffix}`,
        title: 'M3 Test Course',
        credits: 3,
      },
    });
    const teacherProfile = await prisma.teacherProfile.findFirstOrThrow({
      where: { user: { email: TEACHER } },
    });
    const studentProfile = await prisma.studentProfile.findFirstOrThrow({
      where: { user: { email: STUDENT } },
      include: { user: true },
    });
    demoStudentProfileId = studentProfile.id;
    demoStudentUserId = studentProfile.userId;

    const section = await prisma.section.create({
      data: {
        collegeId: college.id,
        courseId: course.id,
        termId: term.id,
        name: 'M3A',
        capacity: 10,
        room: `R-${suffix}`,
      },
    });
    sectionId = section.id;
    const other = await prisma.section.create({
      data: {
        collegeId: college.id,
        courseId: course.id,
        termId: term.id,
        name: 'M3B',
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
      await prisma.notification.deleteMany({
        where: { userId: demoStudentUserId, type: 'attendance.marked_absent' },
      });
      await prisma.attendanceRecord.deleteMany({
        where: { session: { sectionId: { in: [sectionId, otherSectionId] } } },
      });
      await prisma.classSession.deleteMany({
        where: { sectionId: { in: [sectionId, otherSectionId] } },
      });
      await prisma.timetableSlot.deleteMany({
        where: { sectionId: { in: [sectionId, otherSectionId] } },
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
    });
  });

  afterAll(async () => {
    for (const cleanup of cleanups.reverse()) {
      await cleanup().catch(() => undefined);
    }
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  // ── Slots & conflicts ───────────────────────────────────────

  it('admin creates a slot; teacher and student cannot manage slots', async () => {
    const created = await http
      .post('/api/v1/timetable/slots')
      .set(auth(adminToken))
      .send({
        sectionId,
        dayOfWeek: 1,
        startTime: '08:00',
        endTime: '09:00',
        room: `R-${suffix}`,
      });
    expect(created.status).toBe(201);
    slotId = created.body.data.id;

    for (const t of [teacherToken, studentToken]) {
      const denied = await http
        .post('/api/v1/timetable/slots')
        .set(auth(t))
        .send({ sectionId, dayOfWeek: 2, startTime: '08:00', endTime: '09:00' });
      expect(denied.status).toBe(403);
    }
  });

  it('rejects overlapping slots for the same section (SLOT_CONFLICT)', async () => {
    const res = await http
      .post('/api/v1/timetable/slots')
      .set(auth(adminToken))
      .send({ sectionId, dayOfWeek: 1, startTime: '08:30', endTime: '09:30' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SLOT_CONFLICT');
  });

  it('rejects room clashes across sections in the same term (ROOM_CONFLICT)', async () => {
    const res = await http
      .post('/api/v1/timetable/slots')
      .set(auth(adminToken))
      .send({
        sectionId: otherSectionId,
        dayOfWeek: 1,
        startTime: '08:15',
        endTime: '08:45',
        room: `R-${suffix}`,
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ROOM_CONFLICT');
  });

  it('rejects invalid times via the shared schema', async () => {
    const res = await http
      .post('/api/v1/timetable/slots')
      .set(auth(adminToken))
      .send({ sectionId, dayOfWeek: 2, startTime: '10:00', endTime: '09:00' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('timetable view=me is scoped per role', async () => {
    const teacherView = await http
      .get('/api/v1/timetable?view=me')
      .set(auth(teacherToken));
    expect(teacherView.status).toBe(200);
    expect(
      teacherView.body.data.some((s: { sectionId: string }) => s.sectionId === sectionId),
    ).toBe(true);

    const studentView = await http
      .get('/api/v1/timetable?view=me')
      .set(auth(studentToken));
    expect(studentView.status).toBe(200);
    // Student is enrolled in the fixture section but not the other one.
    const sectionIds = studentView.body.data.map(
      (s: { sectionId: string }) => s.sectionId,
    );
    expect(sectionIds).toContain(sectionId);
    expect(sectionIds).not.toContain(otherSectionId);
  });

  // ── Session generation ──────────────────────────────────────

  const weekOf = new Date().toISOString().slice(0, 10);

  it('teacher generates sessions idempotently for an assigned section', async () => {
    const first = await http
      .post(`/api/v1/sections/${sectionId}/sessions/generate?weekOf=${weekOf}`)
      .set(auth(teacherToken));
    expect(first.status).toBe(201);
    expect(first.body.data.created).toBe(1); // one slot in the fixture
    expect(first.body.data.sessions.length).toBeGreaterThanOrEqual(1);

    const second = await http
      .post(`/api/v1/sections/${sectionId}/sessions/generate?weekOf=${weekOf}`)
      .set(auth(teacherToken));
    expect(second.status).toBe(201);
    expect(second.body.data.created).toBe(0); // idempotent
  });

  it('teacher cannot generate sessions for an unassigned section', async () => {
    const res = await http
      .post(`/api/v1/sections/${otherSectionId}/sessions/generate?weekOf=${weekOf}`)
      .set(auth(teacherToken));
    expect(res.status).toBe(403);
  });

  it('rejects generation outside the term (OUTSIDE_TERM)', async () => {
    const res = await http
      .post(`/api/v1/sections/${sectionId}/sessions/generate?weekOf=2030-01-07`)
      .set(auth(teacherToken));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OUTSIDE_TERM');
  });

  // ── Attendance recording ────────────────────────────────────

  let sessionId: string;

  it('teacher records attendance; session becomes HELD; absent notification row is created', async () => {
    const sessions = await http
      .get(`/api/v1/sections/${sectionId}/sessions`)
      .set(auth(teacherToken));
    sessionId = sessions.body.data[0].id;

    const before = await prisma.notification.count({
      where: { userId: demoStudentUserId, type: 'attendance.marked_absent' },
    });

    const saved = await http
      .put(`/api/v1/sessions/${sessionId}/attendance`)
      .set(auth(teacherToken))
      .send({
        records: [{ studentId: demoStudentProfileId, status: 'ABSENT' }],
      });
    expect(saved.status).toBe(200);
    expect(saved.body.data.session.status).toBe('HELD');
    expect(saved.body.data.entries[0].status).toBe('ABSENT');

    await flush();
    const after = await prisma.notification.count({
      where: { userId: demoStudentUserId, type: 'attendance.marked_absent' },
    });
    expect(after).toBe(before + 1);

    // Re-saving the same ABSENT status must not duplicate the notification.
    await http
      .put(`/api/v1/sessions/${sessionId}/attendance`)
      .set(auth(teacherToken))
      .send({
        records: [{ studentId: demoStudentProfileId, status: 'ABSENT' }],
      });
    await flush();
    const again = await prisma.notification.count({
      where: { userId: demoStudentUserId, type: 'attendance.marked_absent' },
    });
    expect(again).toBe(after);
  });

  it('rejects attendance for students not enrolled in the section', async () => {
    const stranger = await prisma.studentProfile.findFirstOrThrow({
      where: { id: { not: demoStudentProfileId } },
    });
    const res = await http
      .put(`/api/v1/sessions/${sessionId}/attendance`)
      .set(auth(teacherToken))
      .send({ records: [{ studentId: stranger.id, status: 'PRESENT' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_ENROLLED');
  });

  it('students cannot record attendance or read the sheet', async () => {
    const save = await http
      .put(`/api/v1/sessions/${sessionId}/attendance`)
      .set(auth(studentToken))
      .send({
        records: [{ studentId: demoStudentProfileId, status: 'PRESENT' }],
      });
    expect(save.status).toBe(403);
    const sheet = await http
      .get(`/api/v1/sessions/${sessionId}/attendance`)
      .set(auth(studentToken));
    expect(sheet.status).toBe(403);
  });

  it('cancelled sessions refuse attendance (SESSION_CANCELLED)', async () => {
    const cancel = await http
      .patch(`/api/v1/sessions/${sessionId}`)
      .set(auth(teacherToken))
      .send({ status: 'CANCELLED' });
    expect(cancel.status).toBe(200);

    const res = await http
      .put(`/api/v1/sessions/${sessionId}/attendance`)
      .set(auth(teacherToken))
      .send({
        records: [{ studentId: demoStudentProfileId, status: 'PRESENT' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SESSION_CANCELLED');

    // Restore to HELD so summary tests below still count it.
    await http
      .patch(`/api/v1/sessions/${sessionId}`)
      .set(auth(teacherToken))
      .send({ status: 'HELD' });
  });

  // ── Summaries ───────────────────────────────────────────────

  it('student summary is OWN-scoped and reflects the recorded absence', async () => {
    const res = await http
      .get('/api/v1/attendance/summary')
      .set(auth(studentToken));
    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe('student');
    const fixture = res.body.data.sections.find(
      (s: { sectionId: string }) => s.sectionId === sectionId,
    );
    expect(fixture).toBeDefined();
    expect(fixture.absent).toBe(1);
    expect(fixture.held).toBe(1);
    expect(fixture.percentage).toBe(0);

    // A student cannot request someone else's summary or a section summary.
    const other = await http
      .get(`/api/v1/attendance/summary?sectionId=${sectionId}`)
      .set(auth(studentToken));
    expect(other.status).toBe(403);
  });

  it('teacher gets a per-student section summary for assigned sections only', async () => {
    const ok = await http
      .get(`/api/v1/attendance/summary?sectionId=${sectionId}`)
      .set(auth(teacherToken));
    expect(ok.status).toBe(200);
    expect(ok.body.data.kind).toBe('section');
    expect(ok.body.data.summary.held).toBe(1);
    const row = ok.body.data.summary.students.find(
      (s: { studentId: string }) => s.studentId === demoStudentProfileId,
    );
    expect(row.absent).toBe(1);

    const denied = await http
      .get(`/api/v1/attendance/summary?sectionId=${otherSectionId}`)
      .set(auth(teacherToken));
    expect(denied.status).toBe(403);
  });

  it('admin can read any section summary (ALL scope)', async () => {
    const res = await http
      .get(`/api/v1/attendance/summary?sectionId=${sectionId}`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.summary.students.length).toBe(1);
  });

  // ── Slot deletion guard ─────────────────────────────────────

  it('slots with sessions cannot be deleted; fresh slots can', async () => {
    const blocked = await http
      .delete(`/api/v1/timetable/slots/${slotId}`)
      .set(auth(adminToken));
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.code).toBe('SLOT_HAS_SESSIONS');

    const fresh = await http
      .post('/api/v1/timetable/slots')
      .set(auth(adminToken))
      .send({ sectionId, dayOfWeek: 6, startTime: '10:00', endTime: '11:00' });
    expect(fresh.status).toBe(201);
    const removed = await http
      .delete(`/api/v1/timetable/slots/${fresh.body.data.id}`)
      .set(auth(adminToken));
    expect(removed.status).toBe(200);
  });

  it('unauthenticated requests are rejected on M3 surfaces', async () => {
    for (const path of [
      '/api/v1/timetable',
      '/api/v1/attendance/summary',
      `/api/v1/sections/${sectionId}/sessions`,
    ]) {
      const res = await http.get(path);
      expect(res.status).toBe(401);
    }
  });
});
