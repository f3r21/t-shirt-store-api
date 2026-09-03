import { ApiSchema } from '@nestjs/swagger';
/** The role names the contract's `User` declares; the seed writes these three. */
export const ROLE_NAMES = ['manager', 'client', 'delivery_person'] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

/** The contract's `User`: six fields and no others, so no hash reaches a response. */
@ApiSchema({ name: 'User' })
export class UserDto {
  id!: number;

  email!: string;

  firstName!: string;

  lastName!: string;

  role!: RoleName;

  /** ISO 8601. The mapper converts the `Date` the database returns. */
  createdAt!: string;
}
