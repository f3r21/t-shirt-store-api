import { seconds } from '@nestjs/throttler';

/**
 * The tier of the three password operations. The key is `default`, so the
 * header stays a plain `Retry-After`. A misspelled key compiles and does
 * nothing, so only the e2e suite proves the limit fires. ADR 7.
 */
export const PASSWORD_THROTTLE = {
  default: { limit: 5, ttl: seconds(900) },
};
