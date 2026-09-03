import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from '../auth/decorators/optional-auth.decorator';
import { AbilityFactory } from './ability.factory';
import { CHECK_POLICIES_KEY } from './check-policies.decorator';
import type { Policy } from './check-policies.decorator';

/**
 * Build the caller's ability and require every policy the handler names.
 *
 * This is the CASL integration the brief asks for, at the controller. It
 * replaces `RolesGuard` and keeps its three invariants, because each one was
 * argued for and each is still right:
 *
 * - **Deny by default.** A handler with no `@CheckPolicies` is 403 for every
 *   caller. A guard whose failure mode is silent permission is not a guard.
 * - **Public routes pass before any work**, and an optional-auth route runs
 *   its policies against the anonymous ability when no token came.
 * - **Anonymous on a closed route is 401**, the honest answer to the caller,
 *   and the assertion that the token guard ran first.
 *
 * What is new: the ability lands on the request, so a handler that needs the
 * conditions, not only the verdict, takes it with `@CurrentAbility()` and
 * hands it to a service, which turns the rules into a `where`.
 *
 * A failing policy is 401 when there is no user and 403 when there is. That
 * is the pair the contract states for the inactive products: a caller with no
 * token cannot be told they are not a manager until they say who they are.
 *
 * **Bound globally, after `AccessTokenGuard`**, in the same providers array,
 * so `request.user` is populated before this reads it. The 403 is a bare
 * `ForbiddenException` on purpose, for the reason DECISIONS 18 gives: the
 * problem mapper's table holds the contract's own wording.
 */
@Injectable()
export class PoliciesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly abilities: AbilityFactory,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }
    const optional =
      this.reflector.getAllAndOverride<boolean>(
        IS_OPTIONAL_AUTH_KEY,
        targets,
      ) === true;

    const request = context.switchToHttp().getRequest<Request>();
    if (!optional && request.user === undefined) {
      throw this.needsToken();
    }

    const policies = this.reflector.getAllAndOverride<Policy[]>(
      CHECK_POLICIES_KEY,
      targets,
    );
    // The deny-by-default branch. No list, or an empty one, is a handler that
    // never said who may reach it, so nobody may.
    if (policies === undefined || policies.length === 0) {
      throw new ForbiddenException();
    }

    const ability = this.abilities.for(request.user);
    request.ability = ability;

    if (!policies.every((policy) => policy(ability, request))) {
      throw request.user === undefined
        ? this.needsToken()
        : new ForbiddenException();
    }
    return true;
  }

  private needsToken(): UnauthorizedException {
    return new UnauthorizedException({
      title: 'Unauthorized',
      detail: 'This operation needs a bearer token.',
    });
  }
}
