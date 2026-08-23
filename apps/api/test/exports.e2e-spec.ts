import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { toCsv, CSV_ROW_CAP, CsvTooLargeError } from '../src/common/csv';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M12-W3 — CSV exports + report-card data path.
 * Exports are ALL-scope only (decision A3): admins pass; teachers
 * (ASSIGNED) and students (OWN) are refused via PolicyService resolution —
 * no role conditionals anywhere.
 */
describe('M12-W3 — exports & report cards', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  let rivalAdminToken: string;
  let rivalCollegeId: string;
  const madeUserIds: string[] = [];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const argon2 = await import('argon2');
    const rival = await prisma.college.create({
      data: { name: 'Rival Export College', code: `RVX-${suffix}` },
    });
    rivalCollegeId = rival.id;
    const rivalAdmin = await prisma.user.create({
      data: {
        college: { connect: { id: rival.id } },
        email: `rvx-admin-${suffix}@campusos.dev`,
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        role: 'ADMIN',
        firstName: 'Rvx',
        lastName: 'Admin',
        mustChangePassword: false,
      },
    });
    madeUserIds.push(rivalAdmin.id);

    adminToken = await login('admin@campusos.dev');
    teacherToken = await login('teacher@campusos.dev');
    studentToken = await login('student@campusos.dev');
    rivalAdminToken = await login(rivalAdmin.email);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: madeUserIds } }, { collegeId: rivalCollegeId }] },
    });
    await prisma.user.deleteMany({ where: { id: { in: madeUserIds } } });
    await prisma.college.delete({ where: { id: rivalCollegeId } });
    // exports.generated audit rows from this suite
    await prisma.auditLog.deleteMany({ where: { action: 'exports.generated' } });
    await app.close();
  });

  describe('csv helper', () => {
    it('escapes quotes/commas/newlines and guards formula injection', () => {
      const csv = toCsv(
        ['a', 'b'],
        [
          ['plain', 'has,comma'],
          ['has"quote', 'line1\nline2'],
          ['=cmd()', '+SUM(A1)'],
          ['-neg', '@import'],
        ],
      );
      expect(csv).toContain('"has,comma"');
      expect(csv).toContain('"has""quote"');
      expect(csv).toContain('"line1\nline2"');
      // Formula guard: leading = + - @ prefixed with a quote.
      expect(csv).toContain("'=cmd()");
      expect(csv).toContain("\"'+SUM(A1)\"".replace('"', '').slice(0, 3));
      expect(csv).toMatch(/'\+SUM\(A1\)/);
      expect(csv).toMatch(/'-neg/);
      expect(csv).toMatch(/'@import/);
    });

    it('enforces the row cap', () => {
      const rows = Array.from({ length: CSV_ROW_CAP + 1 }, () => ['x']);
      expect(() => toCsv(['a'], rows)).toThrow(CsvTooLargeError);
    });
  });

  describe('authorization (A3: resolved ALL scope only)', () => {
    const endpoints = [
      '/api/v1/exports/students.csv',
      '/api/v1/exports/attendance.csv',
      '/api/v1/exports/fees.csv',
      '/api/v1/exports/results.csv?examId=x',
    ];

    it('anonymous requests are 401', async () => {
      for (const url of endpoints) {
        expect((await http.get(url)).status).toBe(401);
      }
    });

    it('students (OWN scope) are refused on every export', async () => {
      for (const url of endpoints) {
        const res = await http.get(url).set(auth(studentToken));
        expect(res.status).toBe(403);
      }
    });

    it('teachers (ASSIGNED scope) are refused on every export', async () => {
      for (const url of endpoints) {
        const res = await http.get(url).set(auth(teacherToken));
        expect(res.status).toBe(403);
      }
    });
  });

  describe('content & tenancy', () => {
    it('students.csv: correct headers, rows, MIME and disposition; audited', async () => {
      const res = await http
        .get('/api/v1/exports/students.csv')
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('students.csv');
      const lines = res.text.trim().split('\r\n');
      expect(lines[0]).toBe(
        'firstName,lastName,email,admissionNo,rollNo,department,batch,status',
      );
      expect(res.text).toContain('student@campusos.dev'); // demo student row
      expect(lines.length).toBeGreaterThan(1);

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'exports.generated' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit?.metadata).toMatchObject({ export: 'students' });
    });

    it('students.csv respects the batch filter', async () => {
      const res = await http
        .get('/api/v1/exports/students.csv?batch=NO-SUCH-BATCH')
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.text.trim().split('\r\n')).toHaveLength(1); // header only
    });

    it('attendance.csv exports demo records with date filtering', async () => {
      const all = await http
        .get('/api/v1/exports/attendance.csv')
        .set(auth(adminToken));
      expect(all.status).toBe(200);
      expect(all.text.split('\r\n')[0]).toBe(
        'date,course,section,rollNo,admissionNo,student,status',
      );
      expect(all.text.trim().split('\r\n').length).toBeGreaterThan(1);

      const none = await http
        .get('/api/v1/exports/attendance.csv?from=1999-01-01&to=1999-01-02')
        .set(auth(adminToken));
      expect(none.text.trim().split('\r\n')).toHaveLength(1);
    });

    it('fees.csv exports invoices with status filter', async () => {
      const res = await http
        .get('/api/v1/exports/fees.csv')
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.text.split('\r\n')[0]).toBe(
        'invoiceNo,student,rollNo,admissionNo,amount,paid,status,dueDate',
      );
      expect(res.text.trim().split('\r\n').length).toBeGreaterThan(1);

      const cancelled = await http
        .get('/api/v1/exports/fees.csv?status=CANCELLED')
        .set(auth(adminToken));
      for (const line of cancelled.text.trim().split('\r\n').slice(1)) {
        expect(line).toContain('CANCELLED');
      }
    });

    it('results.csv exports the published exam marks', async () => {
      const exam = await prisma.exam.findFirstOrThrow({
        where: { status: 'PUBLISHED' },
      });
      const res = await http
        .get(`/api/v1/exports/results.csv?examId=${exam.id}`)
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.text.split('\r\n')[0]).toBe(
        'exam,course,section,rollNo,admissionNo,student,marksObtained,maxMarks',
      );
      expect(res.text.trim().split('\r\n').length).toBeGreaterThan(1);
      expect(res.text).toContain(exam.title);
    });

    it('adversarial tenancy: a rival-college admin gets zero foreign rows', async () => {
      const students = await http
        .get('/api/v1/exports/students.csv')
        .set(auth(rivalAdminToken));
      expect(students.status).toBe(200);
      expect(students.text.trim().split('\r\n')).toHaveLength(1); // header only
      expect(students.text).not.toContain('campusos.dev,'); // no demo emails

      // A foreign examId yields an empty result, never data.
      const exam = await prisma.exam.findFirstOrThrow({
        where: { status: 'PUBLISHED' },
      });
      const results = await http
        .get(`/api/v1/exports/results.csv?examId=${exam.id}`)
        .set(auth(rivalAdminToken));
      expect(results.status).toBe(200);
      expect(results.text.trim().split('\r\n')).toHaveLength(1);

      const attendance = await http
        .get('/api/v1/exports/attendance.csv')
        .set(auth(rivalAdminToken));
      expect(attendance.text.trim().split('\r\n')).toHaveLength(1);

      const fees = await http
        .get('/api/v1/exports/fees.csv')
        .set(auth(rivalAdminToken));
      expect(fees.text.trim().split('\r\n')).toHaveLength(1);
    });
  });

  describe('report-card data path (A2/A4)', () => {
    it('staff with ALL scope can read any student result card via studentId', async () => {
      const student = await prisma.studentProfile.findFirstOrThrow({
        where: { user: { email: 'student@campusos.dev' } },
      });
      const res = await http
        .get(`/api/v1/results?studentId=${student.id}`)
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.data.studentId).toBe(student.id);
      expect(res.body.data.rows.length).toBeGreaterThan(0);
      // Rows carry everything the print view needs.
      const row = res.body.data.rows[0];
      for (const key of ['examId', 'examTitle', 'courseCode', 'marksObtained', 'maxMarks', 'percentage']) {
        expect(row).toHaveProperty(key);
      }
    });

    it('students are pinned to their own card even when passing studentId', async () => {
      const other = await prisma.studentProfile.findFirstOrThrow({
        where: { user: { email: { not: 'student@campusos.dev' } }, collegeId: { not: rivalCollegeId } },
      });
      const own = await prisma.studentProfile.findFirstOrThrow({
        where: { user: { email: 'student@campusos.dev' } },
      });
      const res = await http
        .get(`/api/v1/results?studentId=${other.id}`)
        .set(auth(studentToken));
      expect(res.status).toBe(200);
      expect(res.body.data.studentId).toBe(own.id); // OWN scope forced
    });
  });
});
