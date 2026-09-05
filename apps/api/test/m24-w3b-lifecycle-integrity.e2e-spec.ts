import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { TermLifecycleService } from '../src/academics/term-lifecycle.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M24-W3b — academic lifecycle and grade-band integrity.
 *
 *  N-2   rollover concluded SOURCE-term enrollments (ACTIVE → COMPLETED)
 *        even when the source term was CLOSED, contradicting the file's
 *        own invariant ("source sections and all historical data stay
 *        untouched"; "a CLOSED SOURCE remains valid — reads only"), and
 *        the mutation sat OUTSIDE the SKIP filter so it also ran for
 *        sections the operator marked SKIP.
 *  N-11  grade-band replacement validated overlaps but permitted coverage
 *        GAPS, so a percentage could fall in no band and silently lose its
 *        grade label. COVERAGE HALF ONLY — the retroactive-regrading guard
 *        stays DEFERRED to M25 and is deliberately NOT implemented.
 *  N-14  `Submission.isLate` is persisted once at submit and was never
 *        recomputed, so moving `dueAt` left submissions mis-flagged.
 *  N-15  rollover executed a STALE plan: it was read before the
 *        `FOR UPDATE`, so a concurrent `updatePlan` could be lost.
 *  N-16a the room-conflict check required BOTH slots to carry an explicit
 *        room, while resolution elsewhere is `slot.room ?? section.room`,
 *        so sections sharing a section room were double-booked silently.
 *  N-17  a session with recorded attendance could be flipped to CANCELLED,
 *        orphaning those records (summaries filter `status: 'HELD'`).
 *  N-18  the finalization worklist matched enrollments with no `status`
 *        filter, so DROPPED/COMPLETED students appeared on it.
 *
 * Out of scope and untouched: N-3, N-4, N-12, N-16b.
 */
describe('M24-W3b — academic lifecycle & grade-band integrity', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  const tag = `m24w3b-${suffix}`;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let collegeId: string;
  let departmentId: string;
  let adminUserId: string;
  let passwordHash: string;

  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;

  let yearId: string;
  let courseId: string;

  let bandSnapshot: Array<{
    label: string;
    minPercent: string;
    maxPercent: string;
    gradePoint: string | null;
    sortOrder: number;
  }> = [];

  async function login(email: string): Promise<string> {
    app.get(LoginRateLimiterService).reset();
    const res = await http.post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  const mkTerm = async (label: string, from: string, to: string) =>
    prisma.term.create({
      data: {
        collegeId,
        academicYearId: yearId,
        label: `${tag}-${label}`,
        startsOn: new Date(from),
        endsOn: new Date(to),
        status: 'ACTIVE',
      },
    });

  const mkSection = async (termId: string, name: string, room?: string | null) =>
    prisma.section.create({
      data: {
        collegeId,
        courseId,
        termId,
        name: `${tag}${name}`.slice(0, 20),
        capacity: 40,
        room: room ?? null,
      },
    });

  async function mkStudent(name: string) {
    const user = await prisma.user.create({
      data: {
        collegeId,
        email: `${tag}-${name}@campusos.dev`,
        passwordHash,
        role: 'STUDENT',
        status: 'ACTIVE',
        firstName: name,
        lastName: 'W3b',
        mustChangePassword: false,
        verificationStatus: 'VERIFIED',
      },
    });
    const ident = `${suffix}${name}`.slice(-18);
    const profile = await prisma.studentProfile.create({
      data: {
        collegeId,
        userId: user.id,
        departmentId,
        rollNo: `R${ident}`,
        admissionNo: `A${ident}`,
        batch: '2042',
      },
    });
    return { user, profile };
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    const admin = await prisma.user.findFirstOrThrow({ where: { email: 'admin@campusos.dev' } });
    collegeId = admin.collegeId;
    adminUserId = admin.id;
    passwordHash = admin.passwordHash!;
    departmentId = (await prisma.department.findFirstOrThrow({ where: { collegeId } })).id;

    bandSnapshot = (
      await prisma.gradeBand.findMany({ where: { collegeId }, orderBy: { sortOrder: 'asc' } })
    ).map((b) => ({
      label: b.label,
      minPercent: b.minPercent.toString(),
      maxPercent: b.maxPercent.toString(),
      gradePoint: b.gradePoint === null ? null : b.gradePoint.toString(),
      sortOrder: b.sortOrder,
    }));

    yearId = (
      await prisma.academicYear.create({
        data: {
          collegeId,
          label: `${tag}-AY`,
          startsOn: new Date('2042-08-01'),
          endsOn: new Date('2043-06-30'),
        },
      })
    ).id;
    courseId = (
      await prisma.course.create({
        data: {
          collegeId,
          departmentId,
          code: `${suffix}W3B`.slice(0, 12),
          title: `${tag} Course`,
          credits: 3,
        },
      })
    ).id;

    adminToken = await login('admin@campusos.dev');
    teacherToken = await login('teacher@campusos.dev');
    studentToken = await login('student@campusos.dev');
  });

  afterAll(async () => {
    await prisma.gradeBand.deleteMany({ where: { collegeId } });
    for (const b of bandSnapshot) {
      await prisma.gradeBand.create({
        data: {
          collegeId,
          label: b.label,
          minPercent: b.minPercent,
          maxPercent: b.maxPercent,
          gradePoint: b.gradePoint,
          sortOrder: b.sortOrder,
        },
      });
    }

    const termIds = (
      await prisma.term.findMany({ where: { label: { startsWith: tag } }, select: { id: true } })
    ).map((t) => t.id);
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { targetId: { in: termIds } },
          { actorId: adminUserId, action: 'grade_bands.updated' },
        ],
      },
    });
    await prisma.termRollover.deleteMany({
      where: { OR: [{ fromTermId: { in: termIds } }, { toTermId: { in: termIds } }] },
    });
    await prisma.attendanceRecord.deleteMany({
      where: { session: { section: { termId: { in: termIds } } } },
    });
    await prisma.classSession.deleteMany({ where: { section: { termId: { in: termIds } } } });
    await prisma.timetableSlot.deleteMany({ where: { section: { termId: { in: termIds } } } });
    await prisma.submission.deleteMany({
      where: { assignment: { section: { termId: { in: termIds } } } },
    });
    await prisma.assignment.deleteMany({ where: { section: { termId: { in: termIds } } } });
    await prisma.enrollment.deleteMany({ where: { section: { termId: { in: termIds } } } });
    await prisma.teachingAssignment.deleteMany({
      where: { section: { termId: { in: termIds } } },
    });
    await prisma.section.deleteMany({ where: { termId: { in: termIds } } });
    await prisma.term.deleteMany({ where: { id: { in: termIds } } });
    await prisma.academicYear.deleteMany({ where: { id: yearId } });
    await prisma.studentProfile.deleteMany({ where: { user: { email: { startsWith: tag } } } });
    await prisma.course.deleteMany({ where: { id: courseId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: tag } } });
    await app.close();
  });

  // ══════════════════════ N-11 (coverage half only) ══════════════════════

  describe('N-11 — grade bands must cover 0–100 contiguously (coverage half only)', () => {
    const VALID = [
      { label: 'A', minPercent: 80, maxPercent: 100 },
      { label: 'B', minPercent: 60, maxPercent: 79.99 },
      { label: 'F', minPercent: 0, maxPercent: 59.99 },
    ];
    const put = (bands: unknown, token = adminToken) =>
      http.put('/api/v1/grade-bands').set(auth(token)).send({ bands });
    const currentBands = () =>
      prisma.gradeBand.findMany({ where: { collegeId }, orderBy: { minPercent: 'asc' } });

    it('a contiguous 0–100 configuration is accepted', async () => {
      const res = await put(VALID);
      expect(res.status).toBe(200);
      const rows = await currentBands();
      expect(rows.map((r) => r.label)).toEqual(['F', 'B', 'A']);
      expect(Number(rows[0].minPercent)).toBe(0);
      expect(Number(rows[rows.length - 1].maxPercent)).toBe(100);
    });

    it('boundary-only changes against published results remain allowed (M23 contract preserved)', async () => {
      expect(await prisma.exam.count({ where: { collegeId, status: 'PUBLISHED' } })).toBeGreaterThan(0);
      const res = await put([
        { label: 'A', minPercent: 82, maxPercent: 100 },
        { label: 'B', minPercent: 62, maxPercent: 81.99 },
        { label: 'F', minPercent: 0, maxPercent: 61.99 },
      ]);
      expect(res.status).toBe(200);
    });

    it('a coverage GAP is rejected and changes nothing', async () => {
      await put(VALID);
      const before = await currentBands();
      const auditBefore = await prisma.auditLog.count({ where: { action: 'grade_bands.updated' } });
      const res = await put([
        { label: 'A', minPercent: 80, maxPercent: 100 },
        { label: 'B', minPercent: 61, maxPercent: 79.99 },
        { label: 'F', minPercent: 0, maxPercent: 59.99 },
      ]);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BANDS_NOT_CONTIGUOUS');
      const after = await currentBands();
      expect(after.map((r) => `${r.label}:${r.minPercent}-${r.maxPercent}`)).toEqual(
        before.map((r) => `${r.label}:${r.minPercent}-${r.maxPercent}`),
      );
      expect(await prisma.auditLog.count({ where: { action: 'grade_bands.updated' } })).toBe(auditBefore);
    });

    it('a one-step (0.01) gap is still a gap', async () => {
      const res = await put([
        { label: 'A', minPercent: 80, maxPercent: 100 },
        { label: 'B', minPercent: 60, maxPercent: 79.99 },
        { label: 'F', minPercent: 0, maxPercent: 59.98 },
      ]);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BANDS_NOT_CONTIGUOUS');
    });

    it('coverage must start at 0 and end at 100', async () => {
      const notFromZero = await put([
        { label: 'A', minPercent: 80, maxPercent: 100 },
        { label: 'F', minPercent: 1, maxPercent: 79.99 },
      ]);
      expect(notFromZero.status).toBe(400);
      expect(notFromZero.body.error.code).toBe('BANDS_NOT_CONTIGUOUS');
      const notToHundred = await put([
        { label: 'A', minPercent: 80, maxPercent: 99.99 },
        { label: 'F', minPercent: 0, maxPercent: 79.99 },
      ]);
      expect(notToHundred.status).toBe(400);
      expect(notToHundred.body.error.code).toBe('BANDS_NOT_CONTIGUOUS');
    });

    it('the pre-existing overlap and range validation is preserved', async () => {
      const overlap = await put([
        { label: 'A', minPercent: 50, maxPercent: 100 },
        { label: 'B', minPercent: 40, maxPercent: 60 },
      ]);
      expect(overlap.status).toBe(400);
      expect(overlap.body.error.code).toBe('BANDS_OVERLAP');
      for (const bad of [
        [{ label: 'A', minPercent: -1, maxPercent: 100 }, { label: 'F', minPercent: 0, maxPercent: 50 }],
        [{ label: 'A', minPercent: 0, maxPercent: 101 }, { label: 'F', minPercent: 0, maxPercent: 50 }],
        [{ label: 'A', minPercent: 90, maxPercent: 10 }, { label: 'F', minPercent: 0, maxPercent: 89.99 }],
      ]) {
        expect((await put(bad)).status).toBe(400);
      }
    });

    it('gradePoint preservation (M23-W3 D-2) still works under the new validator', async () => {
      await put(VALID);
      await prisma.gradeBand.updateMany({ where: { collegeId, label: 'A' }, data: { gradePoint: '4' } });
      expect((await put(VALID)).status).toBe(200);
      const a = await prisma.gradeBand.findFirstOrThrow({ where: { collegeId, label: 'A' } });
      expect(a.gradePoint?.toString()).toBe('4');
    });

    it('authorization is unchanged', async () => {
      for (const token of [teacherToken, studentToken]) {
        expect((await put(VALID, token)).status).toBe(403);
      }
      expect((await http.put('/api/v1/grade-bands').send({ bands: VALID })).status).toBe(401);
    });
  });

  // ══════════════════════ N-2 + N-15 (rollover) ══════════════════════

  describe('N-2 — rollover must not mutate the source term', () => {
    async function setupRollover(sourceStatus: 'ACTIVE' | 'CLOSED', action: 'CLONE' | 'SKIP') {
      const uniq = Math.random().toString(36).slice(2, 7);
      const destLabel = `dst-${sourceStatus}-${action}-${uniq}`;
      const source = await mkTerm(`src-${sourceStatus}-${action}-${uniq}`, '2042-08-01', '2042-12-20');
      const dest = await mkTerm(destLabel, '2043-01-05', '2043-05-30');
      const section = await mkSection(source.id, `S${action[0]}${sourceStatus[0]}${uniq}`);
      const { profile } = await mkStudent(`stu${action[0]}${sourceStatus[0]}${uniq}`);
      await prisma.enrollment.create({
        data: { sectionId: section.id, studentId: profile.id, status: 'ACTIVE' },
      });
      if (sourceStatus === 'CLOSED') {
        await prisma.term.update({ where: { id: source.id }, data: { status: 'CLOSED' } });
      }
      const draft = await http
        .post(`/api/v1/terms/${dest.id}/rollover`)
        .set(auth(adminToken))
        .send({ fromTermId: source.id });
      expect(draft.status).toBe(201);
      const patched = await http
        .patch(`/api/v1/terms/${dest.id}/rollover`)
        .set(auth(adminToken))
        .send({
          sections: [
            {
              sourceSectionId: section.id,
              action,
              targetName: 'ROLLED',
              graduateStudents: false,
              carryTeachers: false,
              students: [{ studentId: profile.id, decision: 'CARRY' as const }],
            },
          ],
        });
      expect(patched.status).toBe(200);
      return { source, dest, section, profile, confirmLabel: `${tag}-${destLabel}` };
    }

    it('a CLOSED source term remains a valid rollover source (M17 O-3 preserved)', async () => {
      const { dest } = await setupRollover('CLOSED', 'CLONE');
      const preview = await http.get(`/api/v1/terms/${dest.id}/rollover`).set(auth(adminToken));
      expect(preview.status).toBe(200);
      expect(preview.body.data.status).toBe('DRAFT');
    });

    it('executing against a CLOSED source leaves its enrollments UNTOUCHED', async () => {
      const { source, dest, section, profile, confirmLabel } = await setupRollover('CLOSED', 'CLONE');
      const res = await http
        .post(`/api/v1/terms/${dest.id}/rollover/execute`)
        .set(auth(adminToken))
        .send({ confirmLabel });
      expect(res.status).toBe(201);
      const srcEnrollment = await prisma.enrollment.findFirstOrThrow({
        where: { sectionId: section.id, studentId: profile.id },
      });
      expect(srcEnrollment.status).toBe('ACTIVE');
      expect(res.body.data.counters.enrollmentsCompleted).toBe(0);
      const srcTerm = await prisma.term.findUniqueOrThrow({ where: { id: source.id } });
      expect(srcTerm.status).toBe('CLOSED');
      expect(await prisma.section.count({ where: { termId: source.id } })).toBe(1);
      expect(res.body.data.counters.sectionsCreated).toBe(1);
      expect(await prisma.section.count({ where: { termId: dest.id } })).toBe(1);
    });

    it('a SKIP entry never mutates the source enrollments', async () => {
      const { dest, section, profile, confirmLabel } = await setupRollover('ACTIVE', 'SKIP');
      const res = await http
        .post(`/api/v1/terms/${dest.id}/rollover/execute`)
        .set(auth(adminToken))
        .send({ confirmLabel });
      expect(res.status).toBe(201);
      const srcEnrollment = await prisma.enrollment.findFirstOrThrow({
        where: { sectionId: section.id, studentId: profile.id },
      });
      expect(srcEnrollment.status).toBe('ACTIVE');
      expect(res.body.data.counters.enrollmentsCompleted).toBe(0);
      expect(res.body.data.counters.sectionsCreated).toBe(0);
    });

    it('an ACTIVE source with a carried section still concludes its enrollments (unchanged)', async () => {
      const { dest, section, profile, confirmLabel } = await setupRollover('ACTIVE', 'CLONE');
      const res = await http
        .post(`/api/v1/terms/${dest.id}/rollover/execute`)
        .set(auth(adminToken))
        .send({ confirmLabel });
      expect(res.status).toBe(201);
      expect(res.body.data.counters.enrollmentsCompleted).toBe(1);
      const srcEnrollment = await prisma.enrollment.findFirstOrThrow({
        where: { sectionId: section.id, studentId: profile.id },
      });
      expect(srcEnrollment.status).toBe('COMPLETED');
      expect(res.body.data.counters.enrollmentsCreated).toBe(1);
    });

    it('unauthorized principals cannot execute a rollover', async () => {
      const { dest, confirmLabel } = await setupRollover('ACTIVE', 'CLONE');
      for (const token of [teacherToken, studentToken]) {
        const res = await http
          .post(`/api/v1/terms/${dest.id}/rollover/execute`)
          .set(auth(token))
          .send({ confirmLabel });
        expect(res.status).toBe(403);
      }
    });
  });

  describe('N-15 — rollover must execute the plan as of the lock, not a stale read', () => {
    it('a plan updated after the pre-lock read is still honoured', async () => {
      const source = await mkTerm('n15-src', '2042-08-01', '2042-12-20');
      const dest = await mkTerm('n15-dst', '2043-01-05', '2043-05-30');
      const secA = await mkSection(source.id, 'N15A');
      const secB = await mkSection(source.id, 'N15B');
      const { profile } = await mkStudent('n15stu');
      await prisma.enrollment.create({
        data: { sectionId: secA.id, studentId: profile.id, status: 'ACTIVE' },
      });
      await prisma.enrollment.create({
        data: { sectionId: secB.id, studentId: profile.id, status: 'ACTIVE' },
      });
      expect(
        (
          await http
            .post(`/api/v1/terms/${dest.id}/rollover`)
            .set(auth(adminToken))
            .send({ fromTermId: source.id })
        ).status,
      ).toBe(201);

      // Distinct targetName per entry: destination section names are
      // unique per course+term, so identical names would collide.
      const entry = (sourceSectionId: string, targetName: string) => ({
        sourceSectionId,
        action: 'CLONE' as const,
        targetName,
        graduateStudents: false,
        carryTeachers: false,
        students: [],
      });
      expect(
        (
          await http
            .patch(`/api/v1/terms/${dest.id}/rollover`)
            .set(auth(adminToken))
            .send({ sections: [entry(secA.id, 'RA')] })
        ).status,
      ).toBe(200);

      // Interleave a plan update in the window between the pre-lock read
      // and the in-transaction re-read. `assertTermOpen` is the first
      // statement inside the execution transaction and runs BEFORE the
      // `FOR UPDATE`, so writing here hits exactly the stale window and
      // is not blocked by the row lock. Narrowly scoped; restored in
      // `finally`.
      const lifecycle = app.get(TermLifecycleService);
      const original = lifecycle.assertTermOpen.bind(lifecycle);
      let fired = false;
      let interleaved = -1;
      const spy = jest
        .spyOn(lifecycle, 'assertTermOpen')
        .mockImplementation(async (client, cid, termId) => {
          const result = await original(client, cid, termId);
          if (!fired) {
            fired = true;
            const upd = await prisma.termRollover.updateMany({
              where: { toTermId: dest.id, collegeId, status: 'DRAFT' },
              data: { plan: { sections: [entry(secA.id, 'RA'), entry(secB.id, 'RB')] } as never },
            });
            interleaved = upd.count;
          }
          return result;
        });
      let res: request.Response;
      try {
        res = await http
          .post(`/api/v1/terms/${dest.id}/rollover/execute`)
          .set(auth(adminToken))
          .send({ confirmLabel: `${tag}-n15-dst` });
      } finally {
        spy.mockRestore();
      }
      expect(fired).toBe(true);
      expect(interleaved).toBe(1); // the plan really was updated in the stale window
      expect(res.status).toBe(201);
      // Before the fix the stale v1 plan was applied → 1 section created.
      expect(res.body.data.counters.sectionsCreated).toBe(2);
      expect(await prisma.section.count({ where: { termId: dest.id } })).toBe(2);
    });
  });

  // ══════════════════════ N-14 (dueAt / isLate) ══════════════════════

  describe('N-14 — isLate must follow the assignment due date', () => {
    async function setup(dueAt: string) {
      const uniq = Math.random().toString(36).slice(2, 7);
      const term = await mkTerm(`n14-${uniq}`, '2042-08-01', '2042-12-20');
      const section = await mkSection(term.id, `N14${uniq}`);
      const { profile } = await mkStudent(`n14${uniq}`);
      await prisma.enrollment.create({
        data: { sectionId: section.id, studentId: profile.id, status: 'ACTIVE' },
      });
      const assignment = await prisma.assignment.create({
        data: {
          sectionId: section.id,
          title: `${tag}-hw`,
          description: 'hw',
          createdById: adminUserId,
          maxPoints: 100,
          dueAt: new Date(dueAt),
          allowLate: true,
          publishedAt: new Date(),
        },
      });
      const submission = await prisma.submission.create({
        data: {
          assignmentId: assignment.id,
          studentId: profile.id,
          textContent: 'answer',
          isLate: new Date() > new Date(dueAt),
          submittedAt: new Date(),
        },
      });
      return { assignment, submission };
    }
    const patchDue = (assignmentId: string, dueAt: string) =>
      http.patch(`/api/v1/assignments/${assignmentId}`).set(auth(adminToken)).send({ dueAt });
    const isLate = async (id: string) =>
      (await prisma.submission.findUniqueOrThrow({ where: { id } })).isLate;

    it('moving dueAt into the past marks an on-time submission late', async () => {
      const { assignment, submission } = await setup('2099-01-01T00:00:00.000Z');
      expect(await isLate(submission.id)).toBe(false);
      expect((await patchDue(assignment.id, '2020-01-01T00:00:00.000Z')).status).toBe(200);
      expect(await isLate(submission.id)).toBe(true);
    });

    it('moving dueAt into the future clears a stale late flag', async () => {
      const { assignment, submission } = await setup('2020-01-01T00:00:00.000Z');
      expect(await isLate(submission.id)).toBe(true);
      expect((await patchDue(assignment.id, '2099-01-01T00:00:00.000Z')).status).toBe(200);
      expect(await isLate(submission.id)).toBe(false);
    });

    it('a submission exactly at dueAt is not late, and an unrelated field change leaves isLate alone', async () => {
      const { assignment, submission } = await setup('2099-01-01T00:00:00.000Z');
      await prisma.submission.update({
        where: { id: submission.id },
        data: { submittedAt: assignment.dueAt, isLate: false },
      });
      const res = await http
        .patch(`/api/v1/assignments/${assignment.id}`)
        .set(auth(adminToken))
        .send({ title: `${tag}-renamed` });
      expect(res.status).toBe(200);
      expect(await isLate(submission.id)).toBe(false);
    });

    it('authorization on the assignment update is unchanged', async () => {
      const { assignment } = await setup('2099-01-01T00:00:00.000Z');
      const res = await http
        .patch(`/api/v1/assignments/${assignment.id}`)
        .set(auth(studentToken))
        .send({ dueAt: '2020-01-01T00:00:00.000Z' });
      expect(res.status).toBe(403);
    });
  });

  // ══════════════════════ N-16a (effective room) ══════════════════════

  describe('N-16a — room conflict must use the effective room', () => {
    const slot = (sectionId: string, dayOfWeek: number, startTime: string, endTime: string, room?: string) =>
      http
        .post('/api/v1/timetable/slots')
        .set(auth(adminToken))
        .send({ sectionId, dayOfWeek, startTime, endTime, ...(room ? { room } : {}) });

    it('two sections sharing a SECTION room conflict even with no slot room', async () => {
      const term = await mkTerm('n16-a', '2042-08-01', '2042-12-20');
      const a = await mkSection(term.id, 'N16A', 'SHARED-1');
      const b = await mkSection(term.id, 'N16B', 'SHARED-1');
      expect((await slot(a.id, 2, '09:00', '10:00')).status).toBe(201);
      const second = await slot(b.id, 2, '09:30', '10:30');
      expect(second.status).toBe(400);
      expect(second.body.error.code).toBe('ROOM_CONFLICT');
    });

    it('an explicit slot room still overrides the section room', async () => {
      const term = await mkTerm('n16-b', '2042-08-01', '2042-12-20');
      const a = await mkSection(term.id, 'N16C', 'SHARED-2');
      const b = await mkSection(term.id, 'N16D', 'SHARED-2');
      expect((await slot(a.id, 3, '09:00', '10:00')).status).toBe(201);
      expect((await slot(b.id, 3, '09:30', '10:30', 'OTHER-2')).status).toBe(201);
    });

    it('sections with no room at all do not conflict on room', async () => {
      const term = await mkTerm('n16-c', '2042-08-01', '2042-12-20');
      const a = await mkSection(term.id, 'N16E', null);
      const b = await mkSection(term.id, 'N16F', null);
      expect((await slot(a.id, 4, '09:00', '10:00')).status).toBe(201);
      expect((await slot(b.id, 4, '09:30', '10:30')).status).toBe(201);
    });

    it('the same-section slot conflict rule is unchanged', async () => {
      const term = await mkTerm('n16-d', '2042-08-01', '2042-12-20');
      const a = await mkSection(term.id, 'N16G', null);
      expect((await slot(a.id, 5, '09:00', '10:00')).status).toBe(201);
      const clash = await slot(a.id, 5, '09:30', '10:30');
      expect(clash.status).toBe(400);
      expect(clash.body.error.code).toBe('SLOT_CONFLICT');
    });
  });

  // ══════════════════════ N-17 (cancel with records) ══════════════════════

  describe('N-17 — a session with attendance records cannot be cancelled', () => {
    async function setupSession() {
      const uniq = Math.random().toString(36).slice(2, 7);
      const term = await mkTerm(`n17-${uniq}`, '2042-08-01', '2042-12-20');
      const section = await mkSection(term.id, `N17${uniq}`);
      const { profile } = await mkStudent(`n17${uniq}`);
      await prisma.enrollment.create({
        data: { sectionId: section.id, studentId: profile.id, status: 'ACTIVE' },
      });
      const slotRow = await prisma.timetableSlot.create({
        data: { sectionId: section.id, dayOfWeek: 1, startTime: '09:00', endTime: '10:00' },
      });
      const session = await prisma.classSession.create({
        data: {
          slotId: slotRow.id,
          sectionId: section.id,
          date: new Date('2042-09-01'),
          status: 'SCHEDULED',
        },
      });
      return { session, profile };
    }
    const cancel = (sessionId: string, token = adminToken) =>
      http.patch(`/api/v1/sessions/${sessionId}`).set(auth(token)).send({ status: 'CANCELLED' });

    it('a session with NO attendance records can still be cancelled', async () => {
      const { session } = await setupSession();
      expect((await cancel(session.id)).status).toBe(200);
      expect(
        (await prisma.classSession.findUniqueOrThrow({ where: { id: session.id } })).status,
      ).toBe('CANCELLED');
    });

    it('a session WITH attendance records is refused and left unchanged', async () => {
      const { session, profile } = await setupSession();
      await prisma.attendanceRecord.create({
        data: { sessionId: session.id, studentId: profile.id, status: 'PRESENT', markedById: adminUserId },
      });
      const before = await prisma.classSession.findUniqueOrThrow({ where: { id: session.id } });
      const res = await cancel(session.id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SESSION_HAS_ATTENDANCE');
      const after = await prisma.classSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(after.status).toBe(before.status);
      expect(await prisma.attendanceRecord.count({ where: { sessionId: session.id } })).toBe(1);
    });

    it('other status transitions on a session with records still work', async () => {
      const { session, profile } = await setupSession();
      await prisma.attendanceRecord.create({
        data: { sessionId: session.id, studentId: profile.id, status: 'PRESENT', markedById: adminUserId },
      });
      const res = await http
        .patch(`/api/v1/sessions/${session.id}`)
        .set(auth(adminToken))
        .send({ status: 'HELD' });
      expect(res.status).toBe(200);
      expect(
        (await prisma.classSession.findUniqueOrThrow({ where: { id: session.id } })).status,
      ).toBe('HELD');
    });

    it('a repeated cancellation attempt on a records-bearing session stays refused', async () => {
      const { session, profile } = await setupSession();
      await prisma.attendanceRecord.create({
        data: { sessionId: session.id, studentId: profile.id, status: 'ABSENT', markedById: adminUserId },
      });
      for (let i = 0; i < 2; i += 1) {
        expect((await cancel(session.id)).status).toBe(409);
      }
    });

    it('authorization on session update is unchanged', async () => {
      const { session } = await setupSession();
      expect((await cancel(session.id, studentToken)).status).toBe(403);
    });
  });

  // ══════════════════════ N-18 (worklist ACTIVE filter) ══════════════════════

  describe('N-18 — the finalization worklist lists only ACTIVE enrollments', () => {
    it('DROPPED and COMPLETED enrollments are excluded; ACTIVE is included', async () => {
      const term = await mkTerm('n18', '2042-08-01', '2042-12-20');
      await prisma.term.update({ where: { id: term.id }, data: { status: 'CLOSED' } });
      const section = await mkSection(term.id, 'N18S');
      const activeStu = await mkStudent('n18act');
      const droppedStu = await mkStudent('n18drp');
      const completedStu = await mkStudent('n18cmp');
      await prisma.enrollment.create({
        data: { sectionId: section.id, studentId: activeStu.profile.id, status: 'ACTIVE' },
      });
      await prisma.enrollment.create({
        data: { sectionId: section.id, studentId: droppedStu.profile.id, status: 'DROPPED' },
      });
      await prisma.enrollment.create({
        data: { sectionId: section.id, studentId: completedStu.profile.id, status: 'COMPLETED' },
      });
      const res = await http
        .get(`/api/v1/results/terms/${term.id}/finalization`)
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      const ids = (res.body.data.students as Array<{ studentId: string }>).map((s) => s.studentId);
      expect(ids).toContain(activeStu.profile.id);
      expect(ids).not.toContain(droppedStu.profile.id);
      expect(ids).not.toContain(completedStu.profile.id);
    });

    it('authorization and tenancy on the worklist are unchanged', async () => {
      const term = await mkTerm('n18b', '2042-08-01', '2042-12-20');
      for (const token of [teacherToken, studentToken]) {
        expect(
          (await http.get(`/api/v1/results/terms/${term.id}/finalization`).set(auth(token))).status,
        ).toBe(403);
      }
      expect((await http.get(`/api/v1/results/terms/${term.id}/finalization`)).status).toBe(401);
    });
  });

  // ══════════════════════ invariants ══════════════════════

  describe('invariants', () => {
    it('no role-name conditional was introduced in the touched sources', async () => {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      for (const file of [
        'academics/rollover.service.ts',
        'exams/exams.service.ts',
        'exams/results-finalization.service.ts',
        'assignments/assignments.service.ts',
        'attendance/attendance.service.ts',
        'timetable/timetable.service.ts',
      ]) {
        const src = readFileSync(join(__dirname, '..', 'src', file), 'utf8');
        expect(src).not.toContain('user.role ===');
        for (const role of ['ADMIN', 'TEACHER', 'ACCOUNTANT', 'GUARDIAN']) {
          expect(src).not.toContain(`role === '${role}'`);
        }
      }
    });

    it('M23 S-1 remains closed', async () => {
      const unassigned = await prisma.studentProfile.findFirstOrThrow({
        where: {
          collegeId,
          enrollments: {
            none: {
              status: 'ACTIVE',
              section: {
                teachingAssignments: {
                  some: { teacher: { user: { email: 'teacher@campusos.dev' } } },
                },
              },
            },
          },
        },
      });
      const res = await http
        .get(`/api/v1/results/transcript?studentId=${unassigned.id}`)
        .set(auth(teacherToken));
      expect(res.status).toBe(404);
    });
  });
});
