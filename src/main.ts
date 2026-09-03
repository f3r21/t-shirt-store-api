import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import type { EnvironmentVariables } from './config/env.validation';

async function bootstrap() {
  // `bufferLogs`, so the lines Nest writes while the modules load wait for the
  // pino logger `configureApp` installs, instead of reaching the console.
  // `rawBody`, so the Stripe webhook can verify its signature over the bytes
  // Stripe sent; a parsed and re-serialised body would not match them.
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  configureApp(app);

  // Without this the Prisma disconnect hook never runs on a signal, so a
  // restart leaves the connection to close on its own.
  app.enableShutdownHooks();

  // **The validated value, not `process.env.PORT`.** `validateEnv` reads an
  // empty variable as absent and falls back to 3000, and `@nestjs/config`
  // never overwrites a key the shell already exported, so `PORT=` from a
  // container stayed `''` here and Node refused it with ERR_SOCKET_BAD_PORT.
  // This was the only reader of PORT, so the validated value was read nowhere
  // and its range check guarded a number nothing used.
  const config = app.get(ConfigService<EnvironmentVariables, true>);
  await app.listen(config.getOrThrow<number>('PORT'));
}
void bootstrap();
