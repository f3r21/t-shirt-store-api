import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ROLES_KEY } from './decorators/roles.decorator';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from './decorators/optional-auth.decorator';

/**
 * Refuse a caller whose role the handler does not list, and refuse a handler
 * that lists nothing at all.
 *
 * **This guard denies by default, and that is the whole design.** The previous
 * version returned `true` when a handler carried no `@Roles`, so a route added
 * without the decorator was open to every signed-in caller and nothing said so.
 * A guard whose failure mode is silent permission is not a guard. Now the only
 * ways past it are to say who may pass, with `@Roles`, or to say the route is
 * not about authentication at all, with `@Public` or `@OptionalAuth`. Forgetting
 * all three produces a 403 on the first request, which is the loud failure.
 *
 * It reads the same two keys `AccessTokenGuard` reads rather than introducing a
 * third marker, so a reader learns one vocabulary. A route that is public or
 * optional-auth has already declared that it does not gate on identity, and it
 * would be strange to make it repeat that here.
 *
 * **Bound globally, and the ordering matters.** It is an `APP_GUARD` beside
 * `AccessTokenGuard` in the same providers array, so `request.user` is populated
 * before this reads it. Nest runs guards in registration order, and the previous
 * per-controller binding covered only two of the six controllers, which meant
 * deny by default would not have reached the other four. A guard that protects
 * the routes somebody remembered to protect adds nothing.
 * `test/roles.e2e-spec.ts` asserts the order rather than trusting this comment:
 * an anonymous call to a role-gated route must answer 401 and not 403, which is
 * only true if the token guard ran first.
 *
 * The 403 is a bare `ForbiddenException` on purpose. Nest's default payload
 * carries no title and no detail, so `toProblem` falls back to the table, which
 * gives the contract's own wording for a 403. Supplying them here would risk
 * drifting from it.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    const unauthenticated =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ||
      this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, targets);
    if (unauthenticated) {
      return true;
    }

    const allowed = this.reflector.getAllAndOverride<readonly string[]>(
      ROLES_KEY,
      targets,
    );

    const user = context.switchToHttp().getRequest<Request>().user;
    if (user === undefined) {
      // Anonymous on a route that is neither public nor optional. The token
      // guard should have caught this first, so reaching here means the guards
      // ran in the wrong order. 401 is still the honest answer to the caller.
      throw new UnauthorizedException({
        title: 'Unauthorized',
        detail: 'This operation needs a bearer token.',
      });
    }

    // The deny-by-default branch. An undefined or empty list is a handler that
    // never said who may reach it, so nobody may.
    if (allowed === undefined || allowed.length === 0) {
      throw new ForbiddenException();
    }

    if (!allowed.includes(user.role)) {
      throw new ForbiddenException();
    }
    return true;
  }
}
