import type { UserWithRole } from './user.mapper';

/**
 * Build a `users` row with its `roles` row loaded.
 *
 * Every default is fixed, so two calls in one test return the same values and an
 * assertion on an id is explicit. Pass `overrides` for the field under test.
 *
 * The date matches the contract's own example, at `openapi.yaml:1782`.
 */
export function aUser(overrides: Partial<UserWithRole> = {}): UserWithRole {
  return {
    id: 128,
    email: 'ana@example.com',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaA',
    firstName: 'Ana',
    lastName: 'Ramirez',
    roleId: 2,
    resetTokenHash: null,
    resetTokenExpiresAt: null,
    createdAt: new Date('2026-08-21T13:45:00.000Z'),
    role: { id: 2, name: 'client' },
    ...overrides,
  };
}
