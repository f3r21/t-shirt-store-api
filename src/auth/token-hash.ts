import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The refresh token and the password reset token, and how they are stored.
 *
 * Both are hashed with HMAC-SHA-256 and never with argon2. The reason is
 * structural rather than a preference about speed: both are found *by* their
 * hash. `refresh_tokens.token_hash` carries a unique index, and the reset request
 * body carries only the token and the new password, so there is no second key to
 * find the row by. argon2 draws a fresh salt on every call, so its digest is not
 * a function of its input and the `where` clause could never match. Measured on
 * this machine, argon2 also costs about 40 ms against 0.005 ms, on an endpoint
 * that needs no token to reach.
 *
 * argon2id stays for passwords, where the secret is short, human-chosen and
 * reused, and where the cost and the per-row salt are the whole defence. These
 * values are none of those things: they are 256 bits from a CSPRNG, single use,
 * and short-lived, so there is no dictionary to slow down and nothing to
 * amortise across rows.
 *
 * The pepper is what a bare SHA-256 would not buy: an attacker holding a
 * read-only copy of the database cannot turn a stored hash back into a token
 * that this server will accept. It is deliberately not `JWT_SECRET`, because
 * rotating the signing key would otherwise invalidate every stored hash at the
 * same moment.
 */
export const REFRESH_TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
}

export function hashToken(token: string, pepper: string): string {
  return createHmac('sha256', pepper).update(token).digest('hex');
}

/**
 * Compare two hex digests without leaking their difference through timing.
 *
 * The lookup itself is an index scan, so this is not the boundary that matters,
 * and at 256 bits of input entropy a timing oracle leaks nothing an attacker can
 * act on. It is here for the one comparison the database does not perform: the
 * presented token against `previous_token_hash`.
 */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length || left.length === 0) {
    return false;
  }
  return timingSafeEqual(left, right);
}
