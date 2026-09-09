import { PrismaClient } from '@prisma/client';
import {
  PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  ROLE_PERMISSION_MATRIX,
} from '@campusos/shared';

/**
 * System seed (Blueprint §8 — seed strategy, layer 1).
 * Idempotent: safe to run on every boot. Creates the college row, the
 * permission catalog, the RolePermission matrix, grade bands, and the current
 * academic year + term.
 */
export async function runSystemSeed(prisma: PrismaClient): Promise<string> {
  // ── College (tenant root; single row in MVP) ─────────────────
  const college = await prisma.college.upsert({
    where: { code: 'CAMPUS-01' },
    update: {},
    create: {
      code: 'CAMPUS-01',
      name: 'Evergreen Institute of Technology',
      settings: {
        attendanceWarningThreshold: 75,
        locale: 'en',
      },
    },
  });

  // ── Permission catalog ───────────────────────────────────────
  for (const key of Object.values(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { key },
      update: { description: PERMISSION_DESCRIPTIONS[key] },
      create: { key, description: PERMISSION_DESCRIPTIONS[key] },
    });
  }

  // ── RolePermission matrix ────────────────────────────────────
  const permissions = await prisma.permission.findMany();
  const permissionIdByKey = new Map(permissions.map((p) => [p.key, p.id]));

  for (const grant of ROLE_PERMISSION_MATRIX) {
    const permissionId = permissionIdByKey.get(grant.permission);
    if (!permissionId) {
      throw new Error(`Unknown permission in matrix: ${grant.permission}`);
    }
    await prisma.rolePermission.upsert({
      where: {
        role_permissionId: { role: grant.role, permissionId },
      },
      update: { scope: grant.scope },
      create: { role: grant.role, permissionId, scope: grant.scope },
    });
  }

  // ── Grade bands (percentage → letter; gradePoint dormant) ────
  const gradeBands: Array<{
    label: string;
    minPercent: number;
    maxPercent: number;
    gradePoint: number | null;
    sortOrder: number;
  }> = [
    { label: 'A+', minPercent: 90, maxPercent: 100, gradePoint: null, sortOrder: 1 },
    { label: 'A', minPercent: 80, maxPercent: 89.99, gradePoint: null, sortOrder: 2 },
    { label: 'B+', minPercent: 75, maxPercent: 79.99, gradePoint: null, sortOrder: 3 },
    { label: 'B', minPercent: 70, maxPercent: 74.99, gradePoint: null, sortOrder: 4 },
    { label: 'C+', minPercent: 65, maxPercent: 69.99, gradePoint: null, sortOrder: 5 },
    { label: 'C', minPercent: 60, maxPercent: 64.99, gradePoint: null, sortOrder: 6 },
    { label: 'D', minPercent: 50, maxPercent: 59.99, gradePoint: null, sortOrder: 7 },
    { label: 'F', minPercent: 0, maxPercent: 49.99, gradePoint: null, sortOrder: 8 },
  ];
  for (const band of gradeBands) {
    await prisma.gradeBand.upsert({
      where: {
        collegeId_label: { collegeId: college.id, label: band.label },
      },
      update: {
        minPercent: band.minPercent,
        maxPercent: band.maxPercent,
        sortOrder: band.sortOrder,
      },
      create: { collegeId: college.id, ...band },
    });
  }

  // ── Current academic year + term ─────────────────────────────
  const year = await prisma.academicYear.upsert({
    where: {
      collegeId_label: { collegeId: college.id, label: '2026–27' },
    },
    update: {},
    create: {
      collegeId: college.id,
      label: '2026–27',
      startsOn: new Date('2026-08-01'),
      endsOn: new Date('2027-05-31'),
    },
  });

  const term = await prisma.term.upsert({
    where: {
      academicYearId_label: { academicYearId: year.id, label: 'Fall 2026' },
    },
    update: {},
    create: {
      collegeId: college.id,
      academicYearId: year.id,
      label: 'Fall 2026',
      startsOn: new Date('2026-08-01'),
      endsOn: new Date('2026-12-20'),
      isCurrent: true,
    },
  });

  // App-enforced invariant: exactly one current term per college.
  await prisma.term.updateMany({
    where: { collegeId: college.id, id: { not: term.id }, isCurrent: true },
    data: { isCurrent: false },
  });

  return college.id;
}
