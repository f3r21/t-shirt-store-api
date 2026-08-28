import { ValidationPipeOptions } from '@nestjs/common';
import { validationExceptionFactory } from './problem/validation-exception.factory';

/**
 * The options the global pipe runs with, in one place.
 *
 * `configure-app.ts` builds the application's pipe from these, and
 * `request-validation.spec.ts` builds its own from the same object. A spec that
 * declared its own options would test a pipe the application does not run, and
 * the drift would be invisible: both would pass.
 *
 * `whitelist` with `forbidNonWhitelisted` is what makes an undeclared property a
 * 400 rather than a silent drop, which is why a `role` in a sign-up body cannot
 * become a privilege grant.
 */
export const VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
  exceptionFactory: validationExceptionFactory,
};
