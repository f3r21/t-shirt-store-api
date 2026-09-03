import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { AppAbility } from './ability';

/**
 * The caller's ability, as `PoliciesGuard` built it for this request.
 *
 * Present on every route the guard let through, which is every route that is
 * not `@Public`. A handler that reaches this with no ability is a route the
 * guard never saw, and that is a wiring error worth a crash rather than an
 * empty ability that lets a service filter nothing.
 */
export const CurrentAbility = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AppAbility => {
    const ability = context.switchToHttp().getRequest<Request>().ability;
    if (ability === undefined) {
      throw new Error(
        'No ability on the request. Is the route public, or the guard unbound?',
      );
    }
    return ability;
  },
);
