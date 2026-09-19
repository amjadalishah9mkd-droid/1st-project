import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LoginRateLimiterService } from '../src/auth/login-rate-limiter.service';
import { FileUrlSignerService } from '../src/files/url-signer.service';
import { createTestApp } from './test-app';

const DEMO_PASSWORD = 'CampusOS!demo1';
const STUDENT = 'student@campusos.dev';

describe('M10-W1 — signed, expiring file downloads', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let signer: FileUrlSignerService;
  let studentToken: string;
  let fileUrl: string; // internal unsigned URL as stored in the DB
  let fileKey: string;

  beforeAll(async () => {
    app = await createTestApp();
    signer = app.get(FileUrlSignerService);
    app.get(LoginRateLimiterService).reset();
    http = request(app.getHttpServer());

    const login = await http
      .post('/api/v1/auth/login')
      .send({ email: STUDENT, password: DEMO_PASSWORD });
    studentToken = login.body.data.accessToken;

    const upload = await http
      .post('/api/v1/files')
      .set({ Authorization: `Bearer ${studentToken}` })
      .attach('file', Buffer.from('signed download test', 'utf8'), 'w1.txt');
    expect(upload.status).toBe(201);
    fileUrl = upload.body.data.url;
    fileKey = decodeURIComponent(fileUrl.replace('/api/v1/files/', ''));
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = { get Authorization() { return `Bearer ${studentToken}`; } };

  async function download(url: string) {
    return http.get(url).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  }

  it('uploads still require authentication', async () => {
    const res = await http
      .post('/api/v1/files')
      .attach('file', Buffer.from('x'), 'x.txt');
    expect(res.status).toBe(401);
  });

  it('signing requires authentication and returns a valid signed URL', async () => {
    const unauth = await http.post('/api/v1/files/sign').send({ url: fileUrl });
    expect(unauth.status).toBe(401);

    const signed = await http
      .post('/api/v1/files/sign')
      .set(auth)
      .send({ url: fileUrl });
    expect(signed.status).toBe(201);
    expect(signed.body.data.url).toMatch(/\?exp=\d+&sig=[0-9a-f]{64}$/);
    expect(new Date(signed.body.data.expiresAt).getTime()).toBeGreaterThan(
      Date.now(),
    );

    const res = await download(signed.body.data.url);
    expect(res.status).toBe(200);
    expect((res.body as Buffer).toString('utf8')).toBe('signed download test');
  });

  it('rejects unsigned URLs with 403 SIGNATURE_REQUIRED', async () => {
    const res = await http.get(fileUrl);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SIGNATURE_REQUIRED');
  });

  it('rejects expired signatures with 403 LINK_EXPIRED', async () => {
    const { sig } = { sig: '' };
    void sig;
    // Sign with a TTL in the past.
    const expired = signer.sign(fileKey, -10);
    const res = await http.get(
      `/api/v1/files/${encodeURIComponent(fileKey)}?exp=${expired.exp}&sig=${expired.sig}`,
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('LINK_EXPIRED');
  });

  it('rejects a signature applied to a different key', async () => {
    const other = signer.sign('some-other-key__x.txt');
    const res = await http.get(
      `/api/v1/files/${encodeURIComponent(fileKey)}?exp=${other.exp}&sig=${other.sig}`,
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('rejects a tampered expiry', async () => {
    const { exp, sig } = signer.sign(fileKey);
    const res = await http.get(
      `/api/v1/files/${encodeURIComponent(fileKey)}?exp=${exp + 3600}&sig=${sig}`,
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('rejects a tampered signature', async () => {
    const { exp, sig } = signer.sign(fileKey);
    const flipped = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
    const res = await http.get(
      `/api/v1/files/${encodeURIComponent(fileKey)}?exp=${exp}&sig=${flipped}`,
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');

    const garbage = await http.get(
      `/api/v1/files/${encodeURIComponent(fileKey)}?exp=${exp}&sig=zzzz`,
    );
    expect(garbage.status).toBe(403);
  });

  it('rejects invalid and external sign requests', async () => {
    for (const url of [
      'https://evil.example/api/v1/files/abc',
      '/api/v1/files/../secrets',
      '/api/v1/files/a/b',
      '/api/v1/auth/login',
      '/api/v1/files/',
      'file:///etc/passwd',
    ]) {
      const res = await http
        .post('/api/v1/files/sign')
        .set(auth)
        .send({ url });
      expect([400]).toContain(res.status);
    }
  });

  it('signed URL for a nonexistent key verifies but 404s safely', async () => {
    const ghost = signer.sign('deadbeefdeadbeefdeadbeefdeadbeef__ghost.txt');
    const res = await http.get(
      `/api/v1/files/deadbeefdeadbeefdeadbeefdeadbeef__ghost.txt?exp=${ghost.exp}&sig=${ghost.sig}`,
    );
    expect(res.status).toBe(404);
  });
});
