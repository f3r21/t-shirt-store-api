import type { RefreshToken as RefreshTokenRow } from '../generated/prisma/client';

/** A `refresh_tokens` row. The id and the dates match the contract's `Session` example. */
export function aRefreshToken(
  overrides: Partial<RefreshTokenRow> = {},
): RefreshTokenRow {
  return {
    id: 42,
    userId: 128,
    tokenHash: 'hash-of-the-current-refresh-token',
    previousTokenHash: null,
    deviceName: 'Ana iPhone',
    expiresAt: new Date('2026-08-28T09:14:00.000Z'),
    createdAt: new Date('2026-08-21T09:14:00.000Z'),
    // A row that has never rotated, which is what a fresh sign-in produces.
    // A spec that needs the grace window sets this itself.
    rotatedAt: null,
    // Null is the founder of its own family, which is what a sign-in writes.
    // A spec that needs a second tab's row sets this to the founder's id.
    familyId: null,
    ...overrides,
  };
}
