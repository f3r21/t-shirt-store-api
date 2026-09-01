import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { EnvironmentVariables } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
