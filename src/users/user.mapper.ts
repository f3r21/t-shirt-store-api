import type {
  Role as RoleRow,
  User as UserRow,
} from '../generated/prisma/client';
import type { RoleName, UserDto } from './dto/user.dto';
import { ROLE_NAMES } from './dto/user.dto';

/**
 * A `users` row with its `roles` row loaded. The mapper needs the role name, so
 * the caller must pass `include: { role: true }`. A row without it does not
 * type-check.
 */
export type UserWithRole = UserRow & { role: RoleRow };

/**
 * Map a `users` row to the response shape.
 *
 * The function names every field it copies. It never spreads the row, so
 * `password_hash`, `reset_token_hash` and `reset_token_expires_at` cannot reach
 * a response through this path.
 */
export function toUserDto(user: UserWithRole): UserDto {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: toRoleName(user.role.name),
    createdAt: user.createdAt.toISOString(),
  };
}

function isRoleName(name: string): name is RoleName {
  return (ROLE_NAMES as readonly string[]).includes(name);
}

/**
 * Narrow the role name the database holds to the union the contract declares.
 *
 * The function throws when the name is none of the three. The global filter maps
 * that throw to a 500, which is correct: a role name the contract does not
 * declare is a server fault and not a client fault.
 */
function toRoleName(name: string): RoleName {
  if (!isRoleName(name)) {
    throw new Error(
      `The roles table holds a name the contract does not declare: ${name}`,
    );
  }
  return name;
}
