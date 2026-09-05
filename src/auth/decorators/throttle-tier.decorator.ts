import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SIGN_IN_THROTTLE } from '../sign-in-throttle';
import { PASSWORD_THROTTLE } from '../password-throttle';

/**
 * The sign-in tier (`SIGN_IN_THROTTLE`) and its 429, as one statement: a
 * throttled handler cannot omit the declaration, and the drift suite
 * (`test/openapi-contract.e2e-spec.ts`, "declares the same status codes the
 * contract declares") catches a tier applied to an operation whose contract
 * lacks the 429. ADR 7.
 */
export const SignInTier = () =>
  applyDecorators(
    Throttle(SIGN_IN_THROTTLE),
    ApiResponse({ status: 429, description: 'Too many requests.' }),
  );

/**
 * The password tier (`PASSWORD_THROTTLE`) and its 429, the same statement for
 * the three password operations. ADR 7.
 */
export const PasswordTier = () =>
  applyDecorators(
    Throttle(PASSWORD_THROTTLE),
    ApiResponse({ status: 429, description: 'Too many requests.' }),
  );
