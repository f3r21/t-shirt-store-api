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
 * `secret` sits at the top level, not in `signOptions`, and `expiresIn` is a
 * number of seconds. Not global, so no unrelated service can mint a token. The
 * guards are `APP_GUARD` providers, so a test can substitute them.
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
    // Registration order is run order: the token guard populates
    // `request.user` before the policies guard reads it.
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: PoliciesGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
