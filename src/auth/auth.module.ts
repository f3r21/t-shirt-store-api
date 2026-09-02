import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AccessTokenGuard } from './access-token.guard';
import { PoliciesGuard } from '../authz/policies.guard';
import { EnvironmentVariables } from '../config/env.validation';

/**
 * `secret` sits at the top level and never inside `signOptions`, which is typed
 * as the raw jsonwebtoken options and has no secret member.
 *
 * `expiresIn` receives a number of seconds. The type is `StringValue | number`,
 * where `StringValue` is a template literal union, so a plain `string` from the
 * environment does not satisfy it. Seconds also let the refresh row compute its
 * own expiry without parsing a duration.
 *
 * Not registered globally. The guard that needs `JwtService` lives in this
 * module, and keeping it here means no unrelated service can mint a token.
 *
 * The guard is an `APP_GUARD` provider rather than `useGlobalGuards`, so a test
 * can substitute it, for the same reason `ProblemFilter` is an `APP_FILTER`.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.getOrThrow<number>('JWT_ACCESS_TTL'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Order is the point. Nest runs global guards in registration order, so the
    // token guard populates `request.user` before the roles guard reads it.
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: PoliciesGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
