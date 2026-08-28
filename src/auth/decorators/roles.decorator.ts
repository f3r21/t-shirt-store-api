import { SetMetadata } from '@nestjs/common';
import { RoleName } from '../../users/dto/user.dto';

export const ROLES_KEY = 'roles';

/**
 * The roles allowed to reach this handler.
 *
 * A handler with no marker is open to every authenticated caller, which is what
 * the owner-scoped operations want: they are constrained by the `where` clause
 * on the query rather than by the caller's role.
 *
 * This is the stand-in for CASL, which the brief requires and which replaces it.
 * No service method takes a role, so that swap touches the controllers and
 * nothing else.
 */
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);
