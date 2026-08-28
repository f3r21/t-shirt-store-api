/**
 * The role names the contract declares, at
 * `contract/openapi.yaml:2179-2181`. The `roles`
 * table stores the name as text, so the mapper narrows that text to this union.
 * The seed writes these three spellings.
 */
export const ROLE_NAMES = ['manager', 'client', 'delivery_person'] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

/**
 * Response shape of POST /users.
 *
 * The field list is the point. The `users` row also holds `password_hash`,
 * `reset_token_hash` and `reset_token_expires_at`. The contract names these six
 * fields and no others, at `openapi.yaml:1760-1782`. A serializer that returned
 * the row whole would put a live reset token in a 200.
 */
export class UserDto {
  id!: number;

  email!: string;

  firstName!: string;

  lastName!: string;

  role!: RoleName;

  /** ISO 8601. The mapper converts the `Date` the database returns. */
  createdAt!: string;
}
