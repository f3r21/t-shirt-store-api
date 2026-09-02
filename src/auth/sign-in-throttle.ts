import { seconds } from '@nestjs/throttler';

/**
 * The limit sign-in carries, between the browse default and the password one.
 *
 * The global default is sized for a client reading the catalog, which is far too
 * loose for the operation every credential-stuffing run targets first. This is
 * tighter than that default and looser than `PASSWORD_THROTTLE`, because a person
 * who mistypes a password retries within seconds and a script does not stop at
 * ten.
 *
 * The key is `default` for the same reason it is in `PASSWORD_THROTTLE`:
 * `ThrottlerGuard` suffixes its headers with the throttler name, so any other key
 * emits `Retry-After-<name>` where the contract requires a plain `Retry-After`.
 */
export const SIGN_IN_THROTTLE = {
  default: { limit: 10, ttl: seconds(60) },
};
