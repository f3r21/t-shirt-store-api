import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from './decorators/roles.decorator';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from './decorators/optional-auth.decorator';

/**
 * The deny-by-default branch, which no end to end test can reach.
 *
 * Every route in the application now carries `@Public`, `@OptionalAuth` or
 * `@Roles`, so there is no request that exercises a handler with no marker at
 * all. That case is exactly the one the guard exists to catch: the route
 * somebody adds next week and forgets to decorate. It has to be tested here or
 * nowhere.
 */
describe('RolesGuard', () => {
  /** A context carrying the metadata a handler would have set, and a caller. */
  function contextFor(
    metadata: Record<string, unknown>,
    user?: { role: string },
  ): { guard: RolesGuard; context: ExecutionContext } {
    const reflector = {
      getAllAndOverride: (key: string) => metadata[key],
    } as unknown as Reflector;

    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;

    return { guard: new RolesGuard(reflector), context };
  }

  it('refuses a handler that declares no roles at all', () => {
    const { guard, context } = contextFor({}, { role: 'manager' });

    // A manager, the most privileged caller there is, and still refused. The
    // handler never said who may reach it, so nobody may.
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('refuses a handler whose roles list is empty', () => {
    const { guard, context } = contextFor(
      { [ROLES_KEY]: [] },
      { role: 'manager' },
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('refuses a caller whose role is not listed', () => {
    const { guard, context } = contextFor(
      { [ROLES_KEY]: ['manager'] },
      { role: 'client' },
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('admits a caller whose role is listed', () => {
    const { guard, context } = contextFor(
      { [ROLES_KEY]: ['manager'] },
      { role: 'manager' },
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it.each([
    ['public', IS_PUBLIC_KEY],
    ['optional-auth', IS_OPTIONAL_AUTH_KEY],
  ])('admits a %s route with no roles and no caller', (_label, key) => {
    // The exemption. Both decorators already declare that the route does not
    // gate on identity, so requiring `@Roles` as well would be noise.
    const { guard, context } = contextFor({ [key]: true });

    expect(guard.canActivate(context)).toBe(true);
  });
});
