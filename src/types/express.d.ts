import { AccessTokenPayload } from '../auth/access-token-payload';

/**
 * The guard writes the verified payload onto the request.
 *
 * Without this the assignment needs a bracket index and every read needs a cast,
 * which is how the payload's shape stops being checked at all.
 */
declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

export {};
