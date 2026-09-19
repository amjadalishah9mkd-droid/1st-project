import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { corsOrigins, validateEnv } from '../src/config/env';
import { createTestApp } from './test-app';

const DEV_BASE = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'dev-secret',
};

const PROD_BASE = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db:5432/campusos',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  FILE_URL_SECRET: 'c'.repeat(40),
};

describe('M10-W3 — environment validation & security headers', () => {
  // ── validateEnv ────────────────────────────────────────────

  it('accepts a complete production configuration', () => {
    const config = validateEnv(PROD_BASE);
    expect(config.NODE_ENV).toBe('production');
    expect(config.API_PORT).toBe(4000);
  });

  it('accepts development with only the basics', () => {
    const config = validateEnv(DEV_BASE);
    expect(config.NODE_ENV).toBe('development');
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnv({ NODE_ENV: 'development' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it.each(['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'FILE_URL_SECRET'])(
    'production fails fast when %s is missing',
    (name) => {
      const env = { ...PROD_BASE, [name]: undefined };
      expect(() => validateEnv(env)).toThrow(new RegExp(name));
    },
  );

  it('production rejects short secrets', () => {
    expect(() =>
      validateEnv({ ...PROD_BASE, FILE_URL_SECRET: 'short' }),
    ).toThrow(/FILE_URL_SECRET must be at least 32/);
  });

  it('development requires at least a JWT secret', () => {
    expect(() =>
      validateEnv({ ...DEV_BASE, JWT_ACCESS_SECRET: undefined }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  // ── corsOrigins ────────────────────────────────────────────

  it('production defaults to same-origin only; dev reflects origins', () => {
    expect(corsOrigins(validateEnv(PROD_BASE))).toEqual([]);
    expect(corsOrigins(validateEnv(DEV_BASE))).toBe(true);
    expect(
      corsOrigins(
        validateEnv({
          ...PROD_BASE,
          CORS_ORIGINS: 'https://a.example, https://b.example',
        }),
      ),
    ).toEqual(['https://a.example', 'https://b.example']);
  });

  // ── security headers on the live app ───────────────────────

  describe('helmet headers', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createTestApp();
    });
    afterAll(async () => {
      await app.close();
    });

    it('serves hardened headers and hides the framework', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
    });
  });
});
