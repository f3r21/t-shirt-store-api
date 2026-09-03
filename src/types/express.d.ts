import type { AccessTokenPayload } from '../auth/access-token-payload';
import type { AppAbility } from '../authz/ability';

/**
 * The token guard writes the verified payload onto the request, and the
 * policies guard writes the ability it built from it.
 *
 * Without this the assignment needs a bracket index and every read needs a cast,
 * which is how the payload's shape stops being checked at all.
 */
declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
      ability?: AppAbility;
    }
  }
}

export {};
