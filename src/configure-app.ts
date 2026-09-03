import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import type { Express } from 'express';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoNestLogger } from 'nestjs-pino';
import { VALIDATION_PIPE_OPTIONS } from './common/validation-pipe-options';
import { buildOpenApiDocument } from './openapi/document';
import type { EnvironmentVariables } from './config/env.validation';

/**
 * Everything the application needs beyond its modules, shared with the e2e
 * factory so the suite boots what the server runs. All of it runs before
 * `listen`; middleware registered afterwards never sees a request.
 */
export function configureApp(app: INestApplication): INestApplication {
  // First, so every Nest `Logger` routes through pino. ADR 21.
  app.useLogger(app.get(PinoNestLogger));

  app.setGlobalPrefix('v1');

  app.use(helmet());

  // Empty by default, which refuses every cross-origin browser call. ADR 19.
  const config = app.get(ConfigService<EnvironmentVariables, true>);
  const origins = config
    .get<string>('CORS_ORIGINS')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o !== '');
  // The headers a cross-origin script may read; the browser hides the rest,
  // so supertest cannot see the difference. The contract does not declare
  // `X-Request-Id`, an operational header. ADR 21.
  app.enableCors({
    origin: origins,
    credentials: true,
    exposedHeaders: [
      'Location',
      'WWW-Authenticate',
      'Retry-After',
      'X-Request-Id',
    ],
  });

  // A hop count, never `true`: `true` lets any client forge `X-Forwarded-For`
  // and evade the rate limit. ADR 19.
  const hops = config.get<number>('TRUST_PROXY_HOPS');
  if (hops > 0) {
    const express = app.getHttpAdapter().getInstance() as Express;
    express.set('trust proxy', hops);
  }

  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));

  // At /docs, outside the global prefix, because `SwaggerModule.setup` ignores
  // `setGlobalPrefix`. `test/app.e2e-spec.ts` pins the path.
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app));

  return app;
}
