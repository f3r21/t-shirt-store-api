import { NestFactory } from '@nestjs/core';
import { Logger as PinoNestLogger } from 'nestjs-pino';
import { WorkerModule } from './stock-notifications/worker.module';

/**
 * The queue worker, the image's second entrypoint.
 *
 * An application context and not a server: no port, no controllers, and the
 * same configuration, logger, database and mailer as `main.ts`. A separate
 * process rather than a flag on the API, so the two scale apart and a slow
 * mail provider never holds a request. `npm run start:worker` runs it from
 * `dist/`, and the image runs it as `node dist/src/worker.js`.
 */
async function bootstrap() {
  // `bufferLogs`, for the reason `main.ts` gives: the lines written while the
  // modules load wait for the pino logger installed one line below.
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoNestLogger));

  // The worker's `close()` runs on a signal, so a job in flight finishes and
  // its lock is released before the process ends.
  app.enableShutdownHooks();
}
void bootstrap();
