import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M23-W1 — finalized-results ASSIGNED scope enforcement (finding S-1).
 *
 * Regression cover for a HIGH-severity intra-tenant horizontal
 * authorization defect: `resolveReadTarget` handled OWN and CHILD but let
 * ASSIGNED fall through to a bare same-college StudentProfile lookup, so
 * any TEACHER (results.read = ASSIGNED) could read ANY same-college
 * student's finalized report card and transcript via `?studentId=`.
 *
 * Approved O-1 semantics: a teacher may read finalized academic records
 * only for a student holding an ACTIVE Enrollment in a Section for which
 * that teacher holds a TeachingAssignment — the same server-derived
 * relationship already enforced for live marks and attendance summaries.
 *
 * Every fixture is disposable. The protected demo accounts are used only
 * as read-only principals (admin/student/accountant logins); they are
 * never lifecycle targets and no demo row is mutated.
 */
describe('M23-W1 — finalized results ASSIGNED authorization', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  const tag = `m23w1-${suffix}`;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let collegeId: string;
  let departmentId: string;
  let adminUserId: string;
  let passwordHash: string;

  // principals
  let adminToken: string;
  let teacherAToken: string;
  let teacherBToken: string;
  let teacherCToken: string; // holds no assignment at all
  let studentAToken: string;
  let studentBToken: string;
  let guardianLinkedToken: string;
  let guardianUnrelatedToken: string;
  let guardianRevokedToken: string;

  // fixture academic structure
  let yearId: string;
  let termId: string;
  let termLabel: string;
  let courseId: string;
  let sectionAId: string;
  let sectionBId: string;
  let teacherAProfileId: string;
  let teacherBProfileId: string;
  let studentAProfileId: string; // enrolled in Section A
  let studentBProfileId: string; // enrolled in Section B
  let unenrolledStudentProfileId: string; // same college, no enrollment
  let droppedStudentProfileId: string; // Section A but DROPPED enrollment

  // rival tenant
  let rivalCollegeId: string;
  let rivalStudentProfileId: string;
  let rivalTeacherToken: string;

  const emailFor = (name: string) => `${tag}-${name}@campusos.dev`;

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function makeUser(
    name: string,
    role: 'TEACHER' | 'STUDENT' | 'GUARDIAN',
    college = collegeId,
  ) {
    return prisma.user.create({
      data: {
        collegeId: college,
        email: college === collegeId ? emailFor(name) : `${tag}-${name}@rival.dev`,
        passwordHash,
        role,
        status: 'ACTIVE',
        firstName: name,
        lastName: 'Fixture',
        mustChangePassword: false,
        verificationStatus: 'VERIFIED',
      },
    });
  }

  async function makeStudent(name: string, college = collegeId, deptId = '') {
    const user = await makeUser(name, 'STUDENT', college);
    const ident = `${suffix}${name}`.slice(-20);
    const profile = await prisma.studentProfile.create({
      data: {
        collegeId: college,
        userId: user.id,
        departmentId: deptId || departmentId,
        rollNo: `R${ident}`,
        admissionNo: `A${ident}`,
        batch: '2028',
      },
    });
    return { user, profile };
  }

  async function makeTeacher(name: string, college = collegeId, deptId = '') {
    const user = await makeUser(name, 'TEACHER', college);
    const profile = await prisma.teacherProfile.create({
      data: {
        collegeId: college,
        userId: user.id,
        departmentId: deptId || departmentId,
        employeeNo: `E${`${suffix}${name}`.slice(-20)}`,
        designation: 'Lecturer',
        joinedOn: new Date('2028-01-01'),
      },
    });
    return { user, profile };
  }

  /** Direct FINALIZED snapshot — reads never rebuild from marks (M18 §O-2). */
  async function finalizedSnapshot(studentId: string, sectionId: string, college = collegeId, term = termId) {
    const result = await prisma.termResult.create({
      data: {
        collegeId: college,
        studentId,
        termId: term,
        status: 'FINALIZED',
        overallPercentage: '91.50',
        gradeLabel: 'A+',
        gradePoint: '4.00',
        termGpa: '4.00',
        creditsAttempted: 3,
        creditsEarned: 3,
        finalizedById: adminUserId,
        finalizedAt: new Date(),
      },
    });
    await prisma.courseResult.create({
      data: {
        termResultId: result.id,
        courseId,
        sectionId,
        courseCode: `C-${suffix}`.slice(0, 12),
        courseTitle: 'Fixture Course',
        credits: 3,
        obtained: '91.50',
        maxMarks: '100.00',
        percentage: '91.50',
        gradeLabel: 'A+',
        gradePoint: '4.00',
        passed: true,
      },
    });
    return result;
  }

  const transcript = (token: string, studentId?: string) =>
    http
      .get('/api/v1/results/transcript' + (studentId ? `?studentId=${studentId}` : ''))
      .set(auth(token));

  const reportCard = (token: string, studentId?: string, term = termId) =>
    http
      .get(
        `/api/v1/results/report/term/${term}` +
          (studentId ? `?studentId=${studentId}` : ''),
      )
      .set(auth(token));

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
    adminUserId = admin.id;
    passwordHash = admin.passwordHash!;
    departmentId = (
      await prisma.department.findFirstOrThrow({ where: { collegeId } })
    ).id;

    yearId = (
      await prisma.academicYear.create({
        data: {
          collegeId,
          label: `${tag}-AY`,
          startsOn: new Date('2028-08-01'),
          endsOn: new Date('2029-06-30'),
        },
      })
    ).id;
    termLabel = `${tag}-T`;
    termId = (
      await prisma.term.create({
        data: {
          collegeId,
          academicYearId: yearId,
          label: termLabel,
          startsOn: new Date('2028-08-01'),
          endsOn: new Date('2028-12-20'),
          status: 'CLOSED',
        },
      })
    ).id;
    courseId = (
      await prisma.course.create({
        data: {
          collegeId,
          departmentId,
          code: `${suffix}-C1`.slice(0, 12),
          title: 'Fixture Course',
          credits: 3,
        },
      })
    ).id;

    sectionAId = (
      await prisma.section.create({
        data: { collegeId, courseId, termId, name: `A-${suffix}`.slice(0, 10), capacity: 30 },
      })
    ).id;
    sectionBId = (
      await prisma.section.create({
        data: { collegeId, courseId, termId, name: `B-${suffix}`.slice(0, 10), capacity: 30 },
      })
    ).id;

    const teacherA = await makeTeacher('teachera');
    const teacherB = await makeTeacher('teacherb');
    const teacherC = await makeTeacher('teacherc');
    teacherAProfileId = teacherA.profile.id;
    teacherBProfileId = teacherB.profile.id;

    // Authoritative relationship: A→Section A, B→Section B, C→nothing.
    await prisma.teachingAssignment.create({
      data: { teacherId: teacherAProfileId, sectionId: sectionAId, isPrimary: true },
    });
    await prisma.teachingAssignment.create({
      data: { teacherId: teacherBProfileId, sectionId: sectionBId, isPrimary: true },
    });

    const studentA = await makeStudent('studenta');
    const studentB = await makeStudent('studentb');
    const unenrolled = await makeStudent('lonely');
    const dropped = await makeStudent('dropped');
    studentAProfileId = studentA.profile.id;
    studentBProfileId = studentB.profile.id;
    unenrolledStudentProfileId = unenrolled.profile.id;
    droppedStudentProfileId = dropped.profile.id;

    await prisma.enrollment.create({
      data: { sectionId: sectionAId, studentId: studentAProfileId, status: 'ACTIVE' },
    });
    await prisma.enrollment.create({
      data: { sectionId: sectionBId, studentId: studentBProfileId, status: 'ACTIVE' },
    });
    await prisma.enrollment.create({
      data: { sectionId: sectionAId, studentId: droppedStudentProfileId, status: 'DROPPED' },
    });

    await finalizedSnapshot(studentAProfileId, sectionAId);
    await finalizedSnapshot(studentBProfileId, sectionBId);
    await finalizedSnapshot(droppedStudentProfileId, sectionAId);

    // Guardians: linked (ACTIVE), unrelated, revoked.
    const gLinked = await makeUser('glinked', 'GUARDIAN');
    const gUnrelated = await makeUser('gunrelated', 'GUARDIAN');
    const gRevoked = await makeUser('grevoked', 'GUARDIAN');
    await prisma.guardianLink.create({
      data: {
        collegeId,
        guardianUserId: gLinked.id,
        studentProfileId: studentAProfileId,
        status: 'ACTIVE',
        relationship: 'FATHER',
      },
    });
    await prisma.guardianLink.create({
      data: {
        collegeId,
        guardianUserId: gRevoked.id,
        studentProfileId: studentAProfileId,
        status: 'REVOKED',
        relationship: 'FATHER',
      },
    });

    // Rival tenant with its own teacher/student/assignment/enrollment.
    const rival = await prisma.college.create({
      data: { name: 'M23 Rival College', code: `RV23-${suffix}`.slice(0, 12) },
    });
    rivalCollegeId = rival.id;
    const rivalDept = await prisma.department.create({
      data: { collegeId: rival.id, code: `R23-${suffix}`.slice(0, 10), name: 'RivalDept' },
    });
    const rivalYear = await prisma.academicYear.create({
      data: {
        collegeId: rival.id,
        label: `${tag}-RAY`,
        startsOn: new Date('2028-08-01'),
        endsOn: new Date('2029-06-30'),
      },
    });
    const rivalTermId = (
      await prisma.term.create({
        data: {
          collegeId: rival.id,
          academicYearId: rivalYear.id,
          label: `${tag}-RT`,
          startsOn: new Date('2028-08-01'),
          endsOn: new Date('2028-12-20'),
          status: 'CLOSED',
        },
      })
    ).id;
    const rivalStudent = await makeStudent('rstudent', rival.id, rivalDept.id);
    rivalStudentProfileId = rivalStudent.profile.id;
    const rivalTeacher = await makeTeacher('rteacher', rival.id, rivalDept.id);
    const rivalCourse = await prisma.course.create({
      data: {
        collegeId: rival.id,
        departmentId: rivalDept.id,
        code: `${suffix}-RC`.slice(0, 12),
        title: 'Rival Course',
        credits: 3,
      },
    });
    const rivalSection = await prisma.section.create({
      data: {
        collegeId: rival.id,
        courseId: rivalCourse.id,
        termId: rivalTermId,
        name: 'R1',
        capacity: 10,
      },
    });
    await prisma.teachingAssignment.create({
      data: { teacherId: rivalTeacher.profile.id, sectionId: rivalSection.id },
    });
    await prisma.enrollment.create({
      data: {
        sectionId: rivalSection.id,
        studentId: rivalStudentProfileId,
        status: 'ACTIVE',
      },
    });

    adminToken = await login('admin@campusos.dev');
    teacherAToken = await login(emailFor('teachera'));
    teacherBToken = await login(emailFor('teacherb'));
    teacherCToken = await login(emailFor('teacherc'));
    studentAToken = await login(emailFor('studenta'));
    studentBToken = await login(emailFor('studentb'));
    guardianLinkedToken = await login(emailFor('glinked'));
    guardianUnrelatedToken = await login(emailFor('gunrelated'));
    guardianRevokedToken = await login(emailFor('grevoked'));
    rivalTeacherToken = await login(`${tag}-rteacher@rival.dev`);
  });

  afterAll(async () => {
    // FK-safe teardown, narrowest scope first.
    await prisma.courseResult.deleteMany({
      where: { termResult: { term: { label: { in: [`${tag}-T`, `${tag}-RT`] } } } },
    });
    await prisma.termResult.updateMany({
      where: { term: { label: { in: [`${tag}-T`, `${tag}-RT`] } } },
      data: { supersededById: null },
    });
    await prisma.termResult.deleteMany({
      where: { term: { label: { in: [`${tag}-T`, `${tag}-RT`] } } },
    });
    await prisma.guardianLink.deleteMany({
      where: { guardian: { email: { startsWith: tag } } },
    });
    await prisma.enrollment.deleteMany({
      where: { section: { term: { label: { in: [`${tag}-T`, `${tag}-RT`] } } } },
    });
    await prisma.teachingAssignment.deleteMany({
      where: { section: { term: { label: { in: [`${tag}-T`, `${tag}-RT`] } } } },
    });
    await prisma.section.deleteMany({
      where: { term: { label: { in: [`${tag}-T`, `${tag}-RT`] } } },
    });
    await prisma.term.deleteMany({ where: { label: { in: [`${tag}-T`, `${tag}-RT`] } } });
    await prisma.academicYear.deleteMany({
      where: { label: { in: [`${tag}-AY`, `${tag}-RAY`] } },
    });
    await prisma.course.deleteMany({
      where: { OR: [{ id: courseId }, { collegeId: rivalCollegeId }] },
    });
    await prisma.studentProfile.deleteMany({
      where: { user: { email: { startsWith: tag } } },
    });
    await prisma.teacherProfile.deleteMany({
      where: { user: { email: { startsWith: tag } } },
    });
    await prisma.auditLog.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: tag } } });
    await prisma.department.deleteMany({ where: { collegeId: rivalCollegeId } });
    await prisma.college.deleteMany({ where: { id: rivalCollegeId } });
    await app.close();
  });

  // ── A/B/C: the S-1 regression proper ───────────────────────────────

  describe('S-1 regression — TEACHER/ASSIGNED', () => {
    it('A. teacher reads finalized records for a student they actually teach', async () => {
      const t = await transcript(teacherAToken, studentAProfileId);
      expect(t.status).toBe(200);
      expect(t.body.data.terms.length).toBeGreaterThan(0);
      const r = await reportCard(teacherAToken, studentAProfileId);
      expect(r.status).toBe(200);
      expect(r.body.data.studentName).toContain('studenta');
    });

    it('B. teacher is DENIED a same-college student they do not teach', async () => {
      // The exact request that returned 200 during M23-W0 discovery.
      const t = await transcript(teacherAToken, unenrolledStudentProfileId);
      expect(t.status).toBe(404);
      const r = await reportCard(teacherAToken, unenrolledStudentProfileId);
      expect(r.status).toBe(404);
    });

    it('C. teacher is DENIED another teacher\u2019s assigned student', async () => {
      expect((await transcript(teacherAToken, studentBProfileId)).status).toBe(404);
      expect((await reportCard(teacherAToken, studentBProfileId)).status).toBe(404);
      // …and symmetrically in the other direction.
      expect((await transcript(teacherBToken, studentAProfileId)).status).toBe(404);
      expect((await reportCard(teacherBToken, studentAProfileId)).status).toBe(404);
      // Teacher B legitimately reads its own student.
      expect((await transcript(teacherBToken, studentBProfileId)).status).toBe(200);
    });

    it('a teacher holding no assignment at all reads nobody', async () => {
      for (const target of [
        studentAProfileId,
        studentBProfileId,
        unenrolledStudentProfileId,
      ]) {
        expect((await transcript(teacherCToken, target)).status).toBe(404);
        expect((await reportCard(teacherCToken, target)).status).toBe(404);
      }
    });

    it('ASSIGNED requires an ACTIVE enrollment — a DROPPED enrollment is not access', async () => {
      // Same section as the teacher's assignment, but not actively enrolled.
      expect((await transcript(teacherAToken, droppedStudentProfileId)).status).toBe(404);
      expect((await reportCard(teacherAToken, droppedStudentProfileId)).status).toBe(404);
    });

    it('ASSIGNED without a target still requires an explicit studentId', async () => {
      const res = await transcript(teacherAToken);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MISSING_TARGET');
    });
  });

  // ── DATA MINIMIZATION ──────────────────────────────────────────────

  describe('data minimization on denial', () => {
    it('an unauthorized teacher receives no identity, CGPA, grade or mark data', async () => {
      for (const res of [
        await transcript(teacherAToken, unenrolledStudentProfileId),
        await reportCard(teacherAToken, unenrolledStudentProfileId),
        await transcript(teacherAToken, studentBProfileId),
        await reportCard(teacherAToken, studentBProfileId),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.data).toBeUndefined();
        expect(res.body.error).toBeDefined();
        // Envelope carries a code/message only — never academic payload.
        const body = JSON.stringify(res.body);
        for (const leak of [
          'cgpa',
          'gradeLabel',
          'gradePoint',
          'termGpa',
          'overallPercentage',
          'creditsEarned',
          'rollNo',
          'studentName',
          'courseResults',
          'marksObtained',
          'obtained',
          '91.5',
          'studentb',
          'lonely',
        ]) {
          expect(body.toLowerCase()).not.toContain(leak.toLowerCase());
        }
      }
    });

    it('the authorized response really does carry the data being protected', async () => {
      // Guards the test above against passing for the wrong reason.
      const ok = await transcript(teacherAToken, studentAProfileId);
      expect(ok.status).toBe(200);
      const body = JSON.stringify(ok.body).toLowerCase();
      expect(body).toContain('rollno');
      expect(body).toContain('cgpa');
    });
  });

  // ── OWN / CHILD / ALL preserved ────────────────────────────────────

  describe('other scopes preserved', () => {
    it('E/F. STUDENT/OWN reads itself and cannot pivot to a foreign student', async () => {
      const own = await transcript(studentAToken);
      expect(own.status).toBe(200);
      expect(own.body.data.terms.length).toBeGreaterThan(0);
      // OWN ignores requested ids entirely (existing convention).
      const pivot = await transcript(studentAToken, studentBProfileId);
      expect(pivot.status).toBe(200);
      expect(JSON.stringify(pivot.body)).toEqual(JSON.stringify(own.body));
      const pivotReport = await reportCard(studentBToken, studentAProfileId);
      expect(pivotReport.status).toBe(200);
      expect(pivotReport.body.data.studentName).toContain('studentb');
    });

    it('G/H/I. GUARDIAN/CHILD: linked child allowed, unrelated and revoked denied', async () => {
      expect((await transcript(guardianLinkedToken, studentAProfileId)).status).toBe(200);
      expect((await reportCard(guardianLinkedToken, studentAProfileId)).status).toBe(200);
      expect((await transcript(guardianUnrelatedToken, studentAProfileId)).status).toBe(404);
      expect((await transcript(guardianRevokedToken, studentAProfileId)).status).toBe(404);
      expect((await reportCard(guardianRevokedToken, studentAProfileId)).status).toBe(404);
      // A guardian cannot reach a non-child through the assigned path either.
      expect((await transcript(guardianLinkedToken, studentBProfileId)).status).toBe(404);
    });

    it('J. ALL scope is untouched; accountant holds no results.read grant', async () => {
      for (const target of [
        studentAProfileId,
        studentBProfileId,
        unenrolledStudentProfileId,
      ]) {
        expect((await transcript(adminToken, target)).status).toBe(200);
      }
      expect((await reportCard(adminToken, unenrolledStudentProfileId)).status).toBe(404); // no snapshot
      const accountantToken = await login('accountant@campusos.dev');
      expect((await transcript(accountantToken, studentAProfileId)).status).toBe(403);
    });
  });

  // ── K/L: assignment mutability ─────────────────────────────────────

  describe('K/L. assignment lifecycle and multi-section isolation', () => {
    it('L. teacher assigned to Section A sees Section A students only', async () => {
      expect((await transcript(teacherAToken, studentAProfileId)).status).toBe(200);
      expect((await transcript(teacherAToken, studentBProfileId)).status).toBe(404);
    });

    it('K. access follows the assignment when it is removed and reassigned', async () => {
      // baseline: A can read student A
      expect((await transcript(teacherAToken, studentAProfileId)).status).toBe(200);
      expect((await transcript(teacherCToken, studentAProfileId)).status).toBe(404);

      // remove A's assignment → A is denied immediately (no cached grant)
      await prisma.teachingAssignment.deleteMany({
        where: { teacherId: teacherAProfileId, sectionId: sectionAId },
      });
      expect((await transcript(teacherAToken, studentAProfileId)).status).toBe(404);
      expect((await reportCard(teacherAToken, studentAProfileId)).status).toBe(404);

      // give the section to teacher C → C allowed, A still denied
      const teacherC = await prisma.teacherProfile.findFirstOrThrow({
        where: { user: { email: emailFor('teacherc') } },
      });
      await prisma.teachingAssignment.create({
        data: { teacherId: teacherC.id, sectionId: sectionAId },
      });
      expect((await transcript(teacherCToken, studentAProfileId)).status).toBe(200);
      expect((await transcript(teacherAToken, studentAProfileId)).status).toBe(404);

      // restore the original fixture arrangement
      await prisma.teachingAssignment.deleteMany({
        where: { teacherId: teacherC.id, sectionId: sectionAId },
      });
      await prisma.teachingAssignment.create({
        data: { teacherId: teacherAProfileId, sectionId: sectionAId, isPrimary: true },
      });
      expect((await transcript(teacherAToken, studentAProfileId)).status).toBe(200);
    });
  });

  // ── M/N/O: tenancy, unknown ids, determinism ───────────────────────

  describe('M/N/O. tenancy, unknown ids and determinism', () => {
    it('D/M. a rival-college assignment grants nothing across the tenant boundary', async () => {
      // rival teacher genuinely teaches the rival student, but not here
      expect((await transcript(rivalTeacherToken, studentAProfileId)).status).toBe(404);
      expect((await reportCard(rivalTeacherToken, studentAProfileId)).status).toBe(404);
      // and our teachers cannot reach the rival student
      expect((await transcript(teacherAToken, rivalStudentProfileId)).status).toBe(404);
      expect((await reportCard(teacherAToken, rivalStudentProfileId)).status).toBe(404);
      // ALL scope is still tenant-bounded
      expect((await transcript(adminToken, rivalStudentProfileId)).status).toBe(404);
    });

    it('N. unknown and foreign ids are indistinguishable from unassigned ones', async () => {
      const shapes = await Promise.all([
        transcript(teacherAToken, 'ckdoesnotexist000000000000'),
        transcript(teacherAToken, unenrolledStudentProfileId),
        transcript(teacherAToken, rivalStudentProfileId),
      ]);
      const codes = shapes.map((r) => r.status);
      expect(codes).toEqual([404, 404, 404]);
      // identical error code ⇒ no enumeration oracle
      const errs = shapes.map((r) => r.body.error.code);
      expect(new Set(errs).size).toBe(1);
    });

    it('O. authorization is deterministic and ignores client-supplied authority', async () => {
      // Repeated identical requests never flip.
      for (let i = 0; i < 4; i += 1) {
        expect((await transcript(teacherAToken, unenrolledStudentProfileId)).status).toBe(404);
        expect((await transcript(teacherAToken, studentAProfileId)).status).toBe(200);
      }
      // Client-supplied scope/college/teacher hints are inert.
      const forged = await http
        .get(
          `/api/v1/results/transcript?studentId=${unenrolledStudentProfileId}` +
            `&scope=ALL&collegeId=${rivalCollegeId}&teacherId=${teacherBProfileId}` +
            `&actorId=${adminUserId}&status=FINALIZED`,
        )
        .set(auth(teacherAToken));
      expect(forged.status).toBe(404);
    });
  });

  // ── invariants ─────────────────────────────────────────────────────

  describe('invariants', () => {
    it('no role-name conditional guards finalized-result reads', async () => {
      const src = readFileSync(
        join(__dirname, '..', 'src', 'exams', 'results-finalization.service.ts'),
        'utf8',
      );
      expect(src).not.toContain('user.role');
      for (const role of ['TEACHER', 'ADMIN', 'STUDENT', 'GUARDIAN', 'ACCOUNTANT']) {
        expect(src).not.toContain(`'${role}'`);
      }
      // and the fix routes through PolicyService scope resolution
      expect(src).toContain("scopeFor(user, 'results.read')");
      expect(src).toContain("scope === 'ASSIGNED'");
    });

    it('reads mutated no finalized academic records', async () => {
      const rows = await prisma.termResult.findMany({
        where: { termId },
        select: { status: true, version: true, overallPercentage: true },
      });
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.status).toBe('FINALIZED');
        expect(row.version).toBe(1);
        expect(row.overallPercentage.toString()).toBe('91.5');
      }
    });
  });
});
