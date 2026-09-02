import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { CONFIG_MODULE_OPTIONS } from '../config/config-module-options';
import { EnvironmentVariables } from '../config/env.validation';
import { buildLoggerOptions } from '../logging/logger.options';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { LowStockProcessor } from './low-stock.processor';
import { LowStockWorker } from './low-stock.worker';

/**
 * The worker process's root module: the same configuration, logger, database
 * and mailer as the API, and no controllers, guards or HTTP. `src/worker.ts`
 * boots it, and the e2e suite boots it beside the API with the mailer
 * replaced.
 */
@Module({
  imports: [
    ConfigModule.forRoot(CONFIG_MODULE_OPTIONS),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        buildLoggerOptions(config),
    }),
    PrismaModule,
    MailModule,
  ],
  providers: [LowStockProcessor, LowStockWorker],
})
export class WorkerModule {}
