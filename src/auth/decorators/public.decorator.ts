import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * The route needs no token, and the guard returns before it looks for one.
 *
 * There must be exactly one of these for every operation the contract marks
 * `security: []`. A decorator that is missing makes a public route answer 401,
 * which a test catches loudly. That is the argument for the global guard: the
 * failure that gets noticed is the safe one.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
