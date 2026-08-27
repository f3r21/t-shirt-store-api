import { ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from '../problem/validation-exception.factory';
import { PageQueryDto } from './page-query.dto';
import { CreateUserDto } from '../../users/dto/create-user.dto';
import { ChangePasswordDto } from '../../users/dto/change-password.dto';
import { CreateSessionDto } from '../../auth/dto/create-session.dto';
import { RefreshSessionDto } from '../../auth/dto/refresh-session.dto';
import { RequestPasswordResetDto } from '../../auth/dto/request-password-reset.dto';
import { ResetPasswordDto } from '../../auth/dto/reset-password.dto';

/**
 * Scaffolding for the request DTOs.
 *
 * `runPipe` is the same pipe `src/main.ts` installs, with the same options. A
 * spec that builds its own `ValidationPipe` with different options tests a pipe
 * the application does not run.
 *
 * The pipe resolves when the body passes and rejects with a `BadRequestException`
 * when it fails. Read `getResponse()` for the problem body, which is where
 * `errors[]` lives.
 */
export function runPipe(
  metatype: new () => object,
  value: unknown,
  type: 'body' | 'query' = 'body',
): Promise<unknown> {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: validationExceptionFactory,
  });

  return pipe.transform(value, { type, metatype });
}

void runPipe;

describe('request validation', () => {
  describe('CreateUserDto', () => {
    void CreateUserDto;

    it.todo('accepts a body with all four fields inside their bounds');

    it.todo('rejects an email that is not an email address');

    it.todo('rejects an email longer than 254 characters');

    it.todo('rejects a password shorter than 8 characters');

    it.todo('rejects a password longer than 128 characters');

    it.todo('rejects a first name longer than 100 characters');

    it.todo(
      'rejects an unknown property, so a role in the body cannot be ignored',
    );

    it.todo('names every rejected field once in errors[]');
  });

  describe('CreateSessionDto', () => {
    void CreateSessionDto;

    it.todo('accepts a body without deviceName');

    it.todo('accepts a deviceName of 64 characters');

    it.todo('rejects a deviceName longer than 64 characters');

    it.todo(
      'rejects a password shorter than 8 characters, which is a 400 and not a 401',
    );
  });

  describe('RefreshSessionDto', () => {
    void RefreshSessionDto;

    it.todo('rejects an empty refreshToken');

    it.todo('rejects a refreshToken longer than 512 characters');
  });

  describe('RequestPasswordResetDto', () => {
    void RequestPasswordResetDto;

    it.todo('rejects an email that is not an email address');
  });

  describe('ResetPasswordDto', () => {
    void ResetPasswordDto;

    it.todo('rejects an empty token');

    it.todo('rejects a password shorter than 8 characters');
  });

  describe('ChangePasswordDto', () => {
    void ChangePasswordDto;

    it.todo('rejects a body that carries only currentPassword');

    it.todo('rejects a newPassword shorter than 8 characters');
  });

  describe('PageQueryDto', () => {
    void PageQueryDto;

    it.todo('applies limit 20 and offset 0 when the query carries neither');

    it.todo('converts the string a query carries into a number');

    it.todo('rejects limit 0');

    it.todo('rejects limit 101');

    it.todo('rejects a negative offset');
  });
});
