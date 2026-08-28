import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { SwaggerModule } from '@nestjs/swagger';
import { VALIDATION_PIPE_OPTIONS } from './common/validation-pipe-options';
import { buildOpenApiDocument } from './openapi/document';

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
  app.setGlobalPrefix('v1');

  app.use(helmet());
  app.enableCors();

  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));

  // Served under the global prefix at /v1/docs. The document itself is built
  // with the prefix stripped, so it matches the contract's bare path keys.
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app));

  return app;
}
