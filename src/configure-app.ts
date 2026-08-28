import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { VALIDATION_PIPE_OPTIONS } from './common/validation-pipe-options';

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

  return app;
}
