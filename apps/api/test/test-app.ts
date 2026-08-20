import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { EnvelopeInterceptor } from '../src/common/interceptors/envelope.interceptor';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';

/** Boots the API exactly as main.ts does (prefix, envelopes, cookies). */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  return app;
}

/** Extracts a named cookie value from supertest set-cookie headers. */
export function cookieValue(
  headers: Record<string, unknown>,
  name: string,
): string | undefined {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  for (const entry of list) {
    if (entry.startsWith(`${name}=`)) {
      const value = entry.split(';')[0].slice(name.length + 1);
      return value.length > 0 ? decodeURIComponent(value) : undefined;
    }
  }
  return undefined;
}
