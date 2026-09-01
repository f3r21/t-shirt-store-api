import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { seconds, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EnvironmentVariables } from './config/env.validation';
import { CONFIG_MODULE_OPTIONS } from './config/config-module-options';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { VariantsModule } from './variants/variants.module';
import { ProblemFilter } from './common/problem/problem.filter';

@Module({
  imports: [
    // The options live in `config-module-options.ts`, where `skipProcessEnv`
    // is explained, so that `app.module.spec.ts` can build the same module
    // against an environment it controls.
    ConfigModule.forRoot(CONFIG_MODULE_OPTIONS),
    /**
     * `ttl` is milliseconds in this major version, and `THROTTLE_TTL` is a
     * number of seconds, so the value is wrapped rather than passed through. A
     * raw 60 would be a sixty millisecond window, which limits nothing while
     * still emitting the rate limit headers that make it look configured.
     *
     * One throttler carrying three tiers. The module default is the browse tier;
     * `SIGN_IN_THROTTLE` and `PASSWORD_THROTTLE` override it per route through
     * `@Throttle`, which replaces the `default` entry rather than adding a second
     * throttler. `test/rate-limit.e2e-spec.ts` is what proves all three fire.
     *
     * Left unnamed so its name stays `default`. The guard
     * suffixes its headers with the name, so any other name would emit
     * `Retry-After-<name>` where the contract requires a plain `Retry-After`.
     *
     * `errorMessage` is set because the default is the literal
     * `ThrottlerException: Too Many Requests`, which the problem mapper would
     * copy into `title` against the contract's `Too many requests`. The object
     * form is required to carry it: the array form has no such member.
     *
     * No storage adapter. One process, so the in-memory counter is correct
     * here, and it is the first thing to change if this ever runs twice.
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
    AuthModule,
    UsersModule,
    CategoriesModule,
    ProductsModule,
    VariantsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: ProblemFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
