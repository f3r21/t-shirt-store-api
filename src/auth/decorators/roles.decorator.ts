import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { RoleName } from '../../users/dto/user.dto';

export const ROLES_KEY = 'roles';

/**
 * The roles allowed to reach this handler.
 *
 * A handler with no marker at all reaches nobody. `RolesGuard` denies by
 * default, so an undecorated route answers 403 to every caller including a
 * manager, and that is the point: the route somebody adds next week and forgets
 * to decorate fails closed. Owner-scoped operations that any signed-in caller
 * may reach say so explicitly, with `@Roles(...ROLE_NAMES)`, and are constrained
 * by the `where` clause on the query rather than by the role.
 *
 * **The marker also tells the OpenAPI document.** Needing a token and needing a
 * role are the same fact, and stating it twice is how the served document came
 * to show five public operations as requiring a bearer token: a class level
 * `@ApiBearerAuth` said one thing while `@Public` on the handler said another.
 * Composing the two here means the document cannot disagree with the guard,
 * because there is only one statement to read.
 *
 * This is the stand-in for CASL, which the brief requires and which replaces it.
 * The swap is not confined to the controllers: `products.service.ts:46` and
 * `:126` take the caller and branch on `isManager`, so the visibility rule moves
 * with it.
 */
export const Roles = (...roles: RoleName[]) =>
  applyDecorators(SetMetadata(ROLES_KEY, roles), ApiBearerAuth('bearerAuth'));
