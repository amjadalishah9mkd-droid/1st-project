import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import {
  createRefundSchema,
  PERMISSIONS,
  ROLE_PERMISSION_MATRIX,
} from '@campusos/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { PolicyService } from '../src/access/policy.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { runSystemSeed } from '../prisma/seed/system.seed';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

/**
 * M16-W1 — refund schema + accountant foundation.
 * Covers: migration #10 structures (tables/enums/ACCOUNTANT), the DB-level
 * money invariants (amount > 0 CHECKs, ONE in-flight attempt per payment,
 * NULL-safe provider-ref uniqueness), financial FK Restrict behavior, the
 * accountant permission grants (matrix + live PolicyService + HTTP), seed
 * idempotency, and the shared refund creation contract.
 * Refund SERVICE/ENDPOINTS do not exist yet (W2) — asserted explicitly.
 */
describe('M16-W1 — refund foundation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  const suffix = Date.now().toString(36);
  let collegeId: string;
  let adminId: string;
  let accountantToken: string;
  let studentToken: string;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  // Fixture: a settled payment to hang refund rows on.
  let structureId: string;
  let invoiceId: string;
  let paymentId: string;
  let studentProfileId: string;

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

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@campusos.dev' },
    });
    collegeId = admin.collegeId;
    adminId = admin.id;

    const term = await prisma.term.findFirstOrThrow({ where: { collegeId } });
    const studentProfile = await prisma.studentProfile.findFirstOrThrow({
      where: { collegeId },
    });
    studentProfileId = studentProfile.id;
    const structure = await prisma.feeStructure.create({
      data: {
        collegeId,
        termId: term.id,
        name: `W1RF structure ${suffix}`,
        totalAmount: '800.00',
        components: { create: [{ label: 'Tuition', amount: '800.00' }] },
      },
    });
    structureId = structure.id;
    const invoice = await prisma.invoice.create({
      data: {
        collegeId,
        studentId: studentProfile.id,
        structureId: structure.id,
        invoiceNo: `W1RF-${suffix}`,
        amount: '800.00',
        dueDate: new Date('2027-01-31'),
        status: 'PAID',
      },
    });
    invoiceId = invoice.id;
    const payment = await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amount: '800.00',
        method: 'CASH',
        paidAt: new Date(),
        recordedById: adminId,
      },
    });
    paymentId = payment.id;

    accountantToken = await login('accountant@campusos.dev');
    studentToken = await login('student@campusos.dev');
  });

  afterAll(async () => {
    await prisma.refundAttempt.deleteMany({ where: { paymentId } });
    await prisma.refund.deleteMany({ where: { paymentId } });
    await prisma.payment.deleteMany({ where: { invoiceId } });
    await prisma.invoice.deleteMany({ where: { id: invoiceId } });
    await prisma.feeComponent.deleteMany({ where: { structureId } });
    await prisma.feeStructure.deleteMany({ where: { id: structureId } });
    await app.close();
  });

  describe('migration #10 structures', () => {
    it('refund tables, enums and the ACCOUNTANT role value exist; 10 applied migrations', async () => {
      const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.tables
        WHERE table_name IN ('Refund', 'RefundAttempt')`;
      expect(tables.map((t) => t.table_name).sort()).toEqual([
        'Refund',
        'RefundAttempt',
      ]);

      const enums = await prisma.$queryRaw<Array<{ typname: string; label: string }>>`
        SELECT t.typname, e.enumlabel AS label
        FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname IN ('RefundAttemptStatus', 'RefundMethod', 'RoleKey')`;
      const labels = (name: string) =>
        enums.filter((r) => r.typname === name).map((r) => r.label).sort();
      expect(labels('RefundAttemptStatus')).toEqual([
        'CANCELLED',
        'FAILED',
        'PROCESSING',
        'REQUESTED',
        'SUCCEEDED',
      ]);
      expect(labels('RefundMethod')).toEqual(['PROVIDER', 'RECORDED']);
      expect(labels('RoleKey')).toContain('ACCOUNTANT');

      // M17-W1 added migration #11 — assert the M16 migration is applied
      // and the count can only have grown (the exact total is owned by
      // the newest milestone's own suite).
      const m16 = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM _prisma_migrations
        WHERE migration_name LIKE '%m16_refund_foundation%'
          AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      expect(Number(m16[0].count)).toBe(1);
      const migrations = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      expect(Number(migrations[0].count)).toBeGreaterThanOrEqual(10);
    });

    it('refund creation endpoint exists (W2) and honors the foundation contract', async () => {
      // W1 originally asserted this endpoint's ABSENCE; M16-W2 delivered it.
      const res = await http
        .post(`/api/v1/fees/payments/${paymentId}/refunds`)
        .set(auth(accountantToken))
        .send({ amount: 100, currency: 'PKR', reason: 'foundation probe', method: 'RECORDED' });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('REQUESTED');
      // leave no in-flight attempt behind for the invariant tests below
      await prisma.refundAttempt.deleteMany({ where: { paymentId } });
    });
  });

  describe('database invariants (real DB, no mocks)', () => {
    const attemptData = (over: Record<string, unknown> = {}) => ({
      collegeId,
      paymentId,
      invoiceId,
      amount: new Prisma.Decimal('100.00'),
      reason: 'W1 invariant probe',
      method: 'RECORDED' as const,
      requestedById: adminId,
      ...over,
    });

    afterEach(async () => {
      await prisma.refundAttempt.deleteMany({ where: { paymentId } });
      await prisma.refund.deleteMany({ where: { paymentId } });
    });

    it('amount > 0 CHECK rejects zero/negative on both tables', async () => {
      await expect(
        prisma.refundAttempt.create({
          data: attemptData({ amount: new Prisma.Decimal('0.00') }),
        }),
      ).rejects.toThrow(/amount_positive|constraint/i);
      await expect(
        prisma.refund.create({
          data: {
            paymentId,
            invoiceId,
            amount: new Prisma.Decimal('-5.00'),
            method: 'RECORDED',
            refundedAt: new Date(),
          },
        }),
      ).rejects.toThrow(/amount_positive|constraint/i);
    });

    it('at most ONE in-flight attempt per payment (partial unique index)', async () => {
      await prisma.refundAttempt.create({
        data: attemptData({ status: 'REQUESTED' }),
      });
      await expect(
        prisma.refundAttempt.create({
          data: attemptData({ status: 'PROCESSING' }),
        }),
      ).rejects.toThrow(/one_inflight_per_payment|unique/i);
      // Terminal rows do not count against the invariant.
      await prisma.refundAttempt.updateMany({
        where: { paymentId },
        data: { status: 'FAILED' },
      });
      const second = await prisma.refundAttempt.create({
        data: attemptData({ status: 'REQUESTED' }),
      });
      expect(second.id).toBeTruthy();
    });

    it('multiple NULL provider refs coexist; duplicate provider refs are rejected', async () => {
      const a = await prisma.refundAttempt.create({
        data: attemptData({ status: 'FAILED' }),
      });
      const b = await prisma.refundAttempt.create({
        data: attemptData({ status: 'CANCELLED' }),
      });
      expect(a.providerRefundRef).toBeNull();
      expect(b.providerRefundRef).toBeNull();

      await prisma.refundAttempt.create({
        data: attemptData({
          status: 'SUCCEEDED',
          method: 'PROVIDER',
          provider: 'SAFEPAY',
          providerRefundRef: `refund_${suffix}`,
        }),
      });
      await expect(
        prisma.refundAttempt.create({
          data: attemptData({
            status: 'FAILED',
            method: 'PROVIDER',
            provider: 'SAFEPAY',
            providerRefundRef: `refund_${suffix}`,
          }),
        }),
      ).rejects.toThrow(/unique/i);
    });

    it('financial FKs are Restrict: a payment with a refund cannot be deleted', async () => {
      await prisma.refund.create({
        data: {
          paymentId,
          invoiceId,
          amount: new Prisma.Decimal('50.00'),
          method: 'RECORDED',
          refundedAt: new Date(),
          recordedById: adminId,
        },
      });
      await expect(
        prisma.payment.delete({ where: { id: paymentId } }),
      ).rejects.toThrow(/foreign key|constraint/i);
    });
  });

  describe('accountant role & permissions', () => {
    const accountantGrants = ROLE_PERMISSION_MATRIX.filter(
      (g) => g.role === 'ACCOUNTANT',
    );

    it('matrix grants exactly the five finance permissions, all scope ALL', () => {
      expect(
        accountantGrants.map((g) => g.permission).sort(),
      ).toEqual([
        'audit.read',
        'fees.manage',
        'fees.read',
        'finance.refund',
        'users.read',
      ]);
      expect(accountantGrants.every((g) => g.scope === 'ALL')).toBe(true);
      // Explicitly NOT granted:
      for (const forbidden of [
        'users.manage',
        'academics.manage',
        'settings.manage',
        'moderation.act',
        'verification.manage',
        'announcements.create',
        'enrollment.manage',
        'marks.enter',
      ]) {
        expect(
          accountantGrants.some((g) => g.permission === forbidden),
        ).toBe(false);
      }
      // finance.refund exists in the catalog and belongs to ADMIN too (D-1).
      expect(Object.values(PERMISSIONS)).toContain('finance.refund');
      expect(
        ROLE_PERMISSION_MATRIX.some(
          (g) => g.role === 'ADMIN' && g.permission === 'finance.refund',
        ),
      ).toBe(true);
      // No other role holds finance.refund.
      expect(
        ROLE_PERMISSION_MATRIX.filter(
          (g) => g.permission === 'finance.refund',
        ).map((g) => g.role).sort(),
      ).toEqual(['ACCOUNTANT', 'ADMIN']);
    });

    it('PolicyService resolves finance.refund for accountant and admin; not for others', async () => {
      const policy = app.get(PolicyService);
      const userFor = async (email: string) => {
        const u = await prisma.user.findFirstOrThrow({ where: { email } });
        return {
          id: u.id,
          collegeId: u.collegeId,
          role: u.role,
          status: u.status,
          verificationStatus: u.verificationStatus,
        };
      };
      const scope = (u: Awaited<ReturnType<typeof userFor>>) =>
        policy.scopeFor(u as never, 'finance.refund');
      expect(await scope(await userFor('accountant@campusos.dev'))).toBe('ALL');
      expect(await scope(await userFor('admin@campusos.dev'))).toBe('ALL');
      expect(await scope(await userFor('teacher@campusos.dev'))).toBeFalsy();
      expect(await scope(await userFor('student@campusos.dev'))).toBeFalsy();
    });

    it('accountant reaches existing fees.manage surfaces over HTTP; others are refused', async () => {
      const structures = await http
        .get('/api/v1/fees/structures')
        .set(auth(accountantToken));
      expect(structures.status).toBe(200);

      const reconciliation = await http
        .get('/api/v1/payments/reconciliation')
        .set(auth(accountantToken));
      expect(reconciliation.status).toBe(200);

      const student = await http
        .get('/api/v1/fees/structures')
        .set(auth(studentToken));
      expect(student.status).toBe(403);

      const anonymous = await http.get('/api/v1/fees/structures');
      expect(anonymous.status).toBe(401);
    });

    it('accountant is denied non-finance admin surfaces', async () => {
      const settings = await http
        .get('/api/v1/settings')
        .set(auth(accountantToken));
      expect([403, 404]).toContain(settings.status);
      const createYear = await http
        .post('/api/v1/academic-years')
        .set(auth(accountantToken))
        .send({ label: 'X', startsOn: '2027-08-01', endsOn: '2028-06-30' });
      expect(createYear.status).toBe(403);
    });
  });

  describe('seed', () => {
    it('demo accountant exists with the ACCOUNTANT role', async () => {
      const user = await prisma.user.findFirstOrThrow({
        where: { email: 'accountant@campusos.dev', collegeId },
      });
      expect(user.role).toBe('ACCOUNTANT');
      expect(user.status).toBe('ACTIVE');
    });

    it('system seed is idempotent for the new permission and grants', async () => {
      const counts = async () => ({
        grants: await prisma.rolePermission.count({
          where: { role: 'ACCOUNTANT' },
        }),
        permission: await prisma.permission.count({
          where: { key: 'finance.refund' },
        }),
      });
      const before = await counts();
      expect(before).toEqual({ grants: 5, permission: 1 });
      await runSystemSeed(prisma);
      await runSystemSeed(prisma);
      expect(await counts()).toEqual(before);
      const accountants = await prisma.user.count({
        where: { email: 'accountant@campusos.dev' },
      });
      expect(accountants).toBe(1);
    });
  });

  describe('shared refund creation contract', () => {
    const valid = {
      amount: 100,
      currency: 'PKR',
      reason: 'Duplicate payment',
      method: 'RECORDED',
    };

    it('accepts a valid body and rejects zero/negative/oversized amounts', () => {
      expect(createRefundSchema.safeParse(valid).success).toBe(true);
      expect(createRefundSchema.safeParse({ ...valid, amount: 0 }).success).toBe(false);
      expect(createRefundSchema.safeParse({ ...valid, amount: -5 }).success).toBe(false);
      expect(
        createRefundSchema.safeParse({ ...valid, amount: 2_000_000 }).success,
      ).toBe(false);
    });

    it('rejects non-PKR currency, missing/short reason, unknown method', () => {
      expect(createRefundSchema.safeParse({ ...valid, currency: 'USD' }).success).toBe(false);
      expect(createRefundSchema.safeParse({ ...valid, reason: '' }).success).toBe(false);
      expect(createRefundSchema.safeParse({ ...valid, reason: '  a ' }).success).toBe(false);
      expect(createRefundSchema.safeParse({ ...valid, method: 'CASH' }).success).toBe(false);
    });

    it('exposes NO client-controlled tenancy/provider/identity fields', () => {
      const keys = Object.keys(createRefundSchema.shape);
      expect(keys.sort()).toEqual(['amount', 'currency', 'method', 'reason']);
      for (const forbidden of [
        'collegeId',
        'invoiceId',
        'paymentId',
        'providerRefundRef',
        'provider',
        'refundId',
        'status',
      ]) {
        expect(keys).not.toContain(forbidden);
      }
    });
  });
});
