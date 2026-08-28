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

/**
 * Refuse a caller whose role the handler does not list.
 *
 * Bound per controller with `@UseGuards`, not as a third `APP_GUARD`. Nest runs
 * globally bound guards before class-bound ones, so `request.user` is already
 * populated by `AccessTokenGuard` when this reads it. Two `APP_GUARD` providers
 * already exist in two different modules, and a third would join a
 * cross-module registration order that nothing documents.
 *
 * A handler with no `@Roles` passes through untouched, so the optional-auth
 * routes are unaffected.
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
    const allowed = this.reflector.getAllAndOverride<readonly string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowed === undefined || allowed.length === 0) {
      return true;
    }

    const user = context.switchToHttp().getRequest<Request>().user;
    if (user === undefined) {
      // Reached when a role-gated handler is also marked public or optional.
      // The caller is anonymous, so this is 401 and not 403.
      throw new UnauthorizedException({
        title: 'Unauthorized',
        detail: 'This operation needs a bearer token.',
      });
    }

    if (!allowed.includes(user.role)) {
      throw new ForbiddenException();
    }
    return true;
  }
}
