import { seconds } from '@nestjs/throttler';

/**
 * The sign-in tier, between the browse default and the password one. The key
 * is `default` for the reason `PASSWORD_THROTTLE` gives. ADR 7.
 */
export const SIGN_IN_THROTTLE = {
  default: { limit: 10, ttl: seconds(60) },
};
