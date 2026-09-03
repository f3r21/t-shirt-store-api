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
 * Build the caller's ability and require every policy the handler names. Deny
 * by default; public routes pass first; a failing policy is 401 with no user
 * and 403 with one. The ability lands on the request for `@CurrentAbility()`.
 * Bound after `AccessTokenGuard`. The 403 is a bare `ForbiddenException`, so
 * the title comes from the table (ADR 11). ADR 25.
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
