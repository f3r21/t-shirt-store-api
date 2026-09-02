import { seconds } from '@nestjs/throttler';

/**
 * The tighter limit the three password operations carry.
 *
 * The key is `default`, and that is not cosmetic. `ThrottlerGuard` suffixes its
 * response headers with the throttler's name, so a throttler called anything
 * else would emit `Retry-After-strict` where the contract requires a plain
 * `Retry-After` on every 429. Overriding the default entry keeps the header the
 * contract asks for.
 *
 * The key is also unchecked at compile time: the decorator takes a plain record,
 * so a misspelling compiles and is ignored at run time. Only a test proves that
 * the limit fires.
 */
export const PASSWORD_THROTTLE = {
  default: { limit: 5, ttl: seconds(900) },
};
