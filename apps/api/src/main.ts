import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { requestContextMiddleware } from './common/observability/request-context';
import { corsOrigins, validateEnv } from './config/env';

async function bootstrap(): Promise<void> {
  // Fail fast on misconfiguration (M10-W3) — before anything boots.
  const env = validateEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'warn', 'error'],
    // M14-W3: preserve the raw request body — Safepay signs the exact
    // bytes it sends, so webhook HMAC verification must never re-serialize.
    rawBody: true,
  });

  // Blueprint §7: all routes served under /api/v1
  app.setGlobalPrefix('api/v1');

  // M22-W1: initialize correlation before every other middleware/guard.
  // The effective ID is also returned on every response, including errors.
  app.use(requestContextMiddleware);

  // Security headers + fingerprint reduction (M10-W3).
  app.use(
    helmet({
      // The API serves JSON and file streams only; a strict CSP belongs to
      // the web app. Cross-origin resource policy stays same-site.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.disable('x-powered-by');
  // Behind the Alloy/production reverse proxy: trust the first hop so
  // req.ip (login rate limiting, audit) sees the real client address.
  app.set('trust proxy', 1);

  // Refresh tokens travel as httpOnly cookies (Blueprint §9)
  app.use(cookieParser());

  // Uniform success envelope + uniform error envelope (Blueprint §7)
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Dev: reflect origins for the local web app. Production: explicit
  // CORS_ORIGINS allowlist, otherwise same-origin only.
  app.enableCors({
    origin: corsOrigins(env),
    credentials: true,
  });

  await app.listen(env.API_PORT, '0.0.0.0');
  new Logger('Bootstrap').log(
    `CampusOS API listening on ${env.API_PORT} (/api/v1, ${env.NODE_ENV})`,
  );
}

void bootstrap();
