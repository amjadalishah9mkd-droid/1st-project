import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  // Blueprint §7: all routes served under /api/v1
  app.setGlobalPrefix('api/v1');

  // Refresh tokens travel as httpOnly cookies (Blueprint §9)
  app.use(cookieParser());

  // Uniform success envelope + uniform error envelope (Blueprint §7)
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Web app is same-origin behind the Alloy proxy in production-like setups;
  // during development web (3000) and api (4000) are separate origins.
  app.enableCors({
    origin: true,
    credentials: true,
  });

  const port = Number.parseInt(process.env.API_PORT ?? '4000', 10);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`CampusOS API listening on ${port} (/api/v1)`);
}

void bootstrap();
