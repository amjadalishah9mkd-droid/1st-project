import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { RateLimiterService } from '../src/common/rate-limiter.service';
import { renderMail } from '../src/mail/templates';
import {
  MailService,
  MAIL_TRANSPORT,
  type OutgoingMail,
} from '../src/mail/mail.module';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';

class CapturingTransport {
  sent: OutgoingMail[] = [];
  async deliver(mail: OutgoingMail): Promise<void> {
    this.sent.push(mail);
  }
}

/**
 * M19-W2 — input/authorization hardening.
 *  A. Mail HTML escaping at the layout() chokepoint.
 *  B. Google OAuth callback rate limiting.
 *  C. Guardian-PII / emergency-contact channel hardening (O-2).
 */
describe('M19-W2 — input & guardian privacy hardening', () => {
  // ── A. Mail escaping (pure render — the single chokepoint) ──────────────

  describe('mail template escaping', () => {
    const HOSTILE = `<script>alert("x")</script> & <img src=x onerror='p()'>`;

    it('escapes hostile HTML in interpolated text (tags, quotes, ampersands)', () => {
      const rendered = renderMail({
        kind: 'results_published',
        firstName: HOSTILE,
        examTitle: `"><b>bold</b> & <i>`,
        url: 'https://campusos.example/results',
      });
      expect(rendered.html).not.toContain('<script');
      expect(rendered.html).not.toContain('<img');
      expect(rendered.html).not.toContain('<b>');
      expect(rendered.html).toContain('&lt;script&gt;');
      expect(rendered.html).toContain('&quot;');
      expect(rendered.html).toContain('&amp;');
      // Plain-text part stays raw text (not HTML) — unchanged behavior.
      expect(rendered.text).toContain(HOSTILE);
    });

    it('renders legitimate https links as working anchors (trusted markup kept)', () => {
      const url = 'https://campusos.example/fees?invoice=42&tab=due';
      const rendered = renderMail({
        kind: 'invoice_issued',
        firstName: 'Fatima',
        amount: 'PKR 5,000',
        dueDate: '2026-09-01',
        url,
      });
      expect(rendered.html).toContain(
        `<a href="https://campusos.example/fees?invoice=42&amp;tab=due">`,
      );
      expect(rendered.text).toContain(url);
    });

    it('never turns non-http(s) URL values into anchors (javascript:, data:)', () => {
      for (const evil of ['javascript:alert(1)', 'data:text/html,<script>1</script>']) {
        const rendered = renderMail({
          kind: 'announcement',
          firstName: 'A',
          title: 'T',
          url: evil,
        });
        // Inert: no anchor, no clickable href — the value survives only as
        // escaped text.
        expect(rendered.html).not.toContain('<a ');
        expect(rendered.html).not.toContain('href=');
        expect(rendered.html).not.toContain('<script');
      }
    });

    it('quotes in a URL cannot break out of the href attribute', () => {
      const rendered = renderMail({
        kind: 'announcement',
        firstName: 'A',
        title: 'T',
        url: 'https://evil.example/" onmouseover="p()',
      });
      expect(rendered.html).toContain('href="https://evil.example/&quot;');
      expect(rendered.html).not.toContain('onmouseover="p()"');
    });

    it('MailService strips CR/LF from interpolated values (header/paragraph injection)', async () => {
      const prevSmtp = process.env.SMTP_URL;
      const prevFrom = process.env.MAIL_FROM;
      process.env.SMTP_URL = 'smtp://localhost:2525';
      process.env.MAIL_FROM = 'noreply@campusos.test';
      try {
        const transport = new CapturingTransport();
        const service = new MailService(transport, {
          log: async () => undefined,
        } as never);
        await service.send(
          { id: 'u1', collegeId: 'c1', email: 'x@campusos.test' },
          {
            kind: 'results_published',
            firstName: 'Evil\r\nBcc: victim@example.com',
            examTitle: 'Mid\nTerm',
            url: 'https://campusos.example/results',
          },
        );
        expect(transport.sent).toHaveLength(1);
        expect(transport.sent[0].subject).not.toMatch(/[\r\n]/);
        expect(transport.sent[0].subject).toContain('Mid Term');
        // The injected header line is flattened into a single inert text
        // line: no CR/LF survives anywhere in the rendered message.
        expect(transport.sent[0].html).toContain('Evil Bcc: victim@example.com');
        expect(transport.sent[0].html).not.toMatch(/[\r\n]/);
        expect(transport.sent[0].text).not.toContain('Evil\r\nBcc');
      } finally {
        process.env.SMTP_URL = prevSmtp;
        process.env.MAIL_FROM = prevFrom;
      }
    });
  });

  // ── B + C need the running app ──────────────────────────────────────────

  describe('app-level hardening', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let http: ReturnType<typeof request>;
    const suffix = `w2-${Date.now().toString(36)}`;

    let collegeId: string;
    let rivalCollegeId: string;
    let studentProfileId: string;
    let adminToken: string;
    let teacherToken: string;
    let studentToken: string;
    let rivalAdminToken: string;
    let guardianToken: string; // GUARDIAN user whose email matches guardianEmail — NO link
    let guardianUserId: string;
    const madeUserIds: string[] = [];
    let originalContact: {
      guardianName: string | null;
      guardianPhone: string | null;
      guardianEmail: string | null;
    };

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
      app = await createTestApp([
        { token: MAIL_TRANSPORT, value: new CapturingTransport() },
      ]);
      prisma = app.get(PrismaService);
      http = request(app.getHttpServer());

      const demoStudent = await prisma.user.findFirstOrThrow({
        where: { email: 'student@campusos.dev' },
        include: { studentProfile: true },
      });
      collegeId = demoStudent.collegeId;
      studentProfileId = demoStudent.studentProfile!.id;
      originalContact = {
        guardianName: demoStudent.studentProfile!.guardianName,
        guardianPhone: demoStudent.studentProfile!.guardianPhone,
        guardianEmail: demoStudent.studentProfile!.guardianEmail,
      };
      // Deterministic emergency-contact data for the matrix (restored after).
      await prisma.studentProfile.update({
        where: { id: studentProfileId },
        data: {
          guardianName: 'EC Person',
          guardianPhone: '+92-300-0000000',
          guardianEmail: `ec-${suffix}@campusos.dev`,
        },
      });

      const argon2 = await import('argon2');
      const passwordHash = await argon2.hash(DEMO_PASSWORD, {
        type: argon2.argon2id,
      });
      const rival = await prisma.college.create({
        data: { name: 'Rival College W2', code: `RVW2-${suffix}` },
      });
      rivalCollegeId = rival.id;
      const rivalAdmin = await prisma.user.create({
        data: {
          college: { connect: { id: rival.id } },
          email: `rival-admin-${suffix}@campusos.dev`,
          passwordHash,
          role: 'ADMIN',
          firstName: 'Rival',
          lastName: 'W2',
          mustChangePassword: false,
        },
      });
      madeUserIds.push(rivalAdmin.id);
      // GUARDIAN account whose email EQUALS the student's emergency-contact
      // email — deliberately NO GuardianLink. If the columns ever became an
      // authorization channel, this account would gain access.
      const impostor = await prisma.user.create({
        data: {
          college: { connect: { id: collegeId } },
          email: `ec-${suffix}@campusos.dev`,
          passwordHash,
          role: 'GUARDIAN',
          firstName: 'EC',
          lastName: 'Match',
          mustChangePassword: false,
        },
      });
      guardianUserId = impostor.id;
      madeUserIds.push(impostor.id);

      adminToken = await login('admin@campusos.dev');
      teacherToken = await login('teacher@campusos.dev');
      studentToken = await login('student@campusos.dev');
      rivalAdminToken = await login(rivalAdmin.email);
      guardianToken = await login(impostor.email);
    });

    afterAll(async () => {
      // Restore demo state exactly.
      await prisma.studentProfile.update({
        where: { id: studentProfileId },
        data: originalContact,
      });
      await prisma.guardianLink.deleteMany({
        where: { guardianUserId: { in: madeUserIds } },
      });
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { collegeId: rivalCollegeId },
            { actorId: { in: madeUserIds } },
          ],
        },
      });
      await prisma.user.deleteMany({ where: { id: { in: madeUserIds } } });
      await prisma.college.delete({ where: { id: rivalCollegeId } });
      await app.close();
    });

    // ── B. Google callback limiter ─────────────────────────────────────────

    describe('Google OAuth callback rate limiting', () => {
      it('throttles repeated abusive callbacks per IP; varying params does not bypass', async () => {
        const limiter = app.get(RateLimiterService);
        limiter.reset();
        let last: request.Response | null = null;
        for (let i = 0; i < 60; i += 1) {
          // Attacker-controlled query fields vary every attempt.
          last = await http.get(
            `/api/v1/auth/google/callback?code=c${i}&state=s${i}`,
          );
          expect(last.status).not.toBe(429);
        }
        const throttled = await http.get(
          '/api/v1/auth/google/callback?code=zzz&state=yyy',
        );
        expect(throttled.status).toBe(429);
        expect(throttled.body.error.code).toBe('RATE_LIMITED');
        // No OAuth state, codes or cookies leak in the throttle response.
        expect(JSON.stringify(throttled.body)).not.toContain('zzz');
        expect(throttled.headers['set-cookie']).toBeUndefined();
        limiter.reset();
      });

      it('under the limit, callbacks still reach the normal (safe-failure) flow', async () => {
        app.get(RateLimiterService).reset();
        const res = await http.get(
          '/api/v1/auth/google/callback?code=abc&state=def',
        );
        // Feature-disabled/invalid-state semantics are unchanged: never a
        // 429, never a 5xx with OAuth internals.
        expect([302, 400, 403, 503]).toContain(res.status); // 503 = feature disabled
        expect(res.status).not.toBe(429);
      });
    });

    // ── C. Emergency-contact channel (O-2) ────────────────────────────────

    describe('emergency-contact (legacy guardian columns) hardening', () => {
      const detail = (token: string) =>
        http.get(`/api/v1/students/${studentProfileId}`).set(auth(token));

      it('full-scope staff (admin) sees emergency-contact values', async () => {
        const res = await detail(adminToken);
        expect(res.status).toBe(200);
        expect(res.body.data.guardianName).toBe('EC Person');
        expect(res.body.data.guardianEmail).toBe(`ec-${suffix}@campusos.dev`);
      });

      it('the student themself (OWN scope) sees their own emergency contact', async () => {
        const res = await detail(studentToken);
        expect(res.status).toBe(200);
        expect(res.body.data.guardianName).toBe('EC Person');
      });

      it('ASSIGNED-scope teacher gets the record but NOT the contact PII', async () => {
        const res = await detail(teacherToken);
        expect(res.status).toBe(200); // shared-section access unchanged
        expect(res.body.data.guardianName).toBeNull();
        expect(res.body.data.guardianPhone).toBeNull();
        expect(res.body.data.guardianEmail).toBeNull();
        expect(res.body.data.address).toBeNull();
      });

      it('cross-college staff get 404 (tenancy unchanged)', async () => {
        const res = await detail(rivalAdminToken);
        expect(res.status).toBe(404);
      });

      it('student list responses never include emergency-contact fields', async () => {
        const res = await http.get('/api/v1/students').set(auth(adminToken));
        expect(res.status).toBe(200);
        for (const item of res.body.data as Array<Record<string, unknown>>) {
          expect(item).not.toHaveProperty('guardianName');
          expect(item).not.toHaveProperty('guardianPhone');
          expect(item).not.toHaveProperty('guardianEmail');
        }
      });

      it('a matching emergency-contact email grants NO guardian access', async () => {
        // The impostor guardian's login email equals guardianEmail — but has
        // no GuardianLink, so the children list is empty and the student
        // record is unreachable.
        const children = await http
          .get('/api/v1/guardian/children')
          .set(auth(guardianToken));
        expect(children.status).toBe(200);
        expect(children.body.data).toEqual([]);

        const res = await detail(guardianToken);
        expect([403, 404]).toContain(res.status);
      });

      it('unlink revokes access even while the contact email still matches', async () => {
        // A real link grants children access…
        const link = await prisma.guardianLink.create({
          data: {
            collegeId,
            guardianUserId,
            studentProfileId,
            relationship: 'FATHER',
            status: 'ACTIVE',
          },
        });
        const linked = await http
          .get('/api/v1/guardian/children')
          .set(auth(guardianToken));
        expect(linked.status).toBe(200);
        expect(linked.body.data).toHaveLength(1);

        // …and revoking it removes ALL access; the matching emergency-contact
        // email keeps no residual authorization.
        await prisma.guardianLink.update({
          where: { id: link.id },
          data: { status: 'REVOKED', revokedAt: new Date() },
        });
        const revoked = await http
          .get('/api/v1/guardian/children')
          .set(auth(guardianToken));
        expect(revoked.status).toBe(200);
        expect(revoked.body.data).toEqual([]);
        await prisma.guardianLink.delete({ where: { id: link.id } });
      });
    });
  });
});
