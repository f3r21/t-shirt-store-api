import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { seconds, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from './health.controller';
import { LoggerModule } from 'nestjs-pino';
import { EnvironmentVariables } from './config/env.validation';
import { CONFIG_MODULE_OPTIONS } from './config/config-module-options';
import { buildLoggerOptions } from './logging/logger.options';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { VariantsModule } from './variants/variants.module';
import { CartModule } from './cart/cart.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { LikesModule } from './likes/likes.module';
import { ImagesModule } from './images/images.module';
import { AuthzModule } from './authz/authz.module';
import { ProblemFilter } from './common/problem/problem.filter';

@Module({
  imports: [
    // The options live in `config-module-options.ts`, where `skipProcessEnv`
    // is explained, so that `app.module.spec.ts` can build the same module
    // against an environment it controls.
    ConfigModule.forRoot(CONFIG_MODULE_OPTIONS),
    /**
     * pino, through nestjs-pino. The module also mounts pino-http, which is
     * where the request id is minted and the completion line is written. The
     * options and their reasons are in `logging/logger.options.ts`; the
     * `useLogger` call that routes every Nest `Logger` through it is in
     * `configure-app.ts`, so the end-to-end suite gets the same logger.
     */
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        buildLoggerOptions(config),
    }),
    /**
     * `ttl` is milliseconds in this major, so `THROTTLE_TTL` is wrapped. One
     * throttler named `default`, so the header is a plain `Retry-After`;
     * `SIGN_IN_THROTTLE` and `PASSWORD_THROTTLE` override it per route.
     * `errorMessage` keeps the contract's title. In-memory storage: one
     * process. ADR 7.
     */
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        errorMessage: 'Too many requests',
        throttlers: [
          {
            ttl: seconds(config.getOrThrow<number>('THROTTLE_TTL')),
            limit: config.getOrThrow<number>('THROTTLE_LIMIT'),
          },
        ],
      }),
    }),
    PrismaModule,
    MailModule,
    AuthzModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    ProductsModule,
    VariantsModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
    LikesModule,
    ImagesModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: ProblemFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
