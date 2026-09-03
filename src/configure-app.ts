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
 * Everything the application needs beyond its modules.
 *
 * Extracted from `main.ts` so that an end-to-end test boots the same
 * application the server runs. A suite that builds `AppModule` on its own gets
 * no global prefix and no validation pipe, so every assertion about a 400 would
 * pass for the wrong reason.
 *
 * Order matters and is the trap this codebase has already sprung once: all of
 * this must run before `listen`, because middleware registered afterwards never
 * sees a request and nothing fails loudly when that happens.
 */
export function configureApp(app: INestApplication): INestApplication {
  // **First, so nothing below logs through the console.** Every
  // `new Logger(Name)` in `src` stays Nest's and is routed through pino by this
  // one call, which is why no service, guard or filter had to change its
  // constructor. `bufferLogs` at creation holds the lines written before this
  // runs, and they flush here.
  app.useLogger(app.get(PinoNestLogger));

  app.setGlobalPrefix('v1');

  app.use(helmet());

  // **Read from the environment, and empty by default.** This was
  // `app.enableCors()` with no argument, which is Nest's fully permissive
  // default, `Access-Control-Allow-Origin: *` on every route including the six
  // manager-only catalog mutations, one line below `helmet()`. Measured against
  // the `cors` package directly rather than read from its documentation:
  // `require('cors')(undefined)` answers `*` to an origin of
  // `https://evil.example`.
  //
  // An empty list refuses every cross-origin browser call, which is the right
  // answer for a service with no configured front end. A deployment that has
  // one names it.
  const config = app.get(ConfigService<EnvironmentVariables, true>);
  const origins = config
    .get<string>('CORS_ORIGINS')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o !== '');
  // **`exposedHeaders`, or the browser cannot read what the contract promises.**
  //
  // CORS hands a cross-origin script six headers and hides every other one, and
  // the hiding happens in the browser, so the server sends them either way and
  // supertest reads them either way. Nothing in this suite could see the
  // difference: `rg -i exposedHeaders src test` exited 1 while the served
  // document declared `WWW-Authenticate` on 15 responses, `Retry-After` on 4
  // and `Location` on 4.
  //
  // The effect on a front end is exact. `POST /auth/sessions` answers 201 and
  // `res.headers.get('Location')` is null, so a client cannot find the session
  // it just created. A 401 arrives with no `WWW-Authenticate` and a 429 with no
  // `Retry-After`, so a client cannot tell how long to wait.
  //
  // Listed rather than derived from the contract on purpose: this is the set the
  // server actually sends, and `openapi-contract.e2e-spec.ts` is what keeps the
  // two honest. `X-Request-Id` is the one the contract does not declare, on
  // purpose: it is operational, not part of any operation, and ADR 21
  // says why a browser client still has to be able to read it.
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

  // **A hop count, never `true`.** The rate limit is keyed on `req.ip`, and with
  // `trust proxy` unset that address is the socket's, which behind a load
  // balancer is the balancer: every caller shares one counter and one abusive
  // client answers 429 to the whole store. `trust proxy: true` would fix the
  // sharing and open a worse hole, because any client could then forge
  // `X-Forwarded-For` and evade the limit entirely. Express reads the nth
  // address from the right, so the number has to match the deployment.
  //
  // 0 keeps today's behaviour, which is correct with no proxy in front.
  const hops = config.get<number>('TRUST_PROXY_HOPS');
  if (hops > 0) {
    const express = app.getHttpAdapter().getInstance() as Express;
    express.set('trust proxy', hops);
  }

  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));

  // Served at /docs, outside the global prefix, with the JSON at /docs-json.
  // `SwaggerModule.setup` mounts on the Express instance and takes no notice of
  // `setGlobalPrefix` unless it is told to, so the prefix does not apply here.
  // The comment above this line used to say /v1/docs, which answers 404. It is
  // pinned by a test now, in `test/app.e2e-spec.ts`, because a comment is the
  // one kind of documentation nothing checks.
  //
  // The document itself is built with the prefix stripped, so its path keys
  // match the contract's.
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app));

  return app;
}
