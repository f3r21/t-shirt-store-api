import type { ValidationPipeOptions } from '@nestjs/common';
import { validationExceptionFactory } from './problem/validation-exception.factory';

/**
 * The global pipe's options, shared with `request-validation.spec.ts` so the
 * spec tests the pipe the application runs. `forbidNonWhitelisted` makes an
 * undeclared property a 400, so a `role` in a sign-up body cannot become a
 * grant.
 */
export const VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
  exceptionFactory: validationExceptionFactory,
};
