import { createHmac, randomBytes } from 'node:crypto';

/**
 * The refresh and reset tokens: 32 random bytes, stored as `HMAC-SHA-256` with
 * a pepper, because both rows are found by their hash and argon2's digest is
 * not a function of its input. ADR 1.
 */
const REFRESH_TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
}

export function hashToken(token: string, pepper: string): string {
  return createHmac('sha256', pepper).update(token).digest('hex');
}
