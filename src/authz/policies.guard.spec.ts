import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { AbilityBuilder } from '@casl/ability';
import type { Request } from 'express';
import { createPrismaAbility } from './casl-prisma';
import type { AppAbility } from './ability';
import { PoliciesGuard } from './policies.guard';
import { AbilityFactory } from './ability.factory';
import { CHECK_POLICIES_KEY } from './check-policies.decorator';
import type { Policy } from './check-policies.decorator';
import {
  can,
  inactiveProductsNeedManager,
  placeOrder,
  updateOrCancelOrder,
} from './policies';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from '../auth/decorators/optional-auth.decorator';
import { AS_CLIENT, AS_MANAGER } from '../products/products.fixtures';
import { AS_DELIVERY } from './authz.fixtures';

/**
 * The branches no end to end test can reach, and the ones they can, once.
 *
 * Every route in the application carries `@Public`, `@OptionalAuth` or
 * `@CheckPolicies`, so no request exercises a handler with no marker at all.
 * That case is exactly the one the guard exists to catch: the route somebody
 * adds next week and forgets to decorate. It has to be tested here or nowhere.
 */
describe('PoliciesGuard', () => {
  /** A context carrying the metadata a handler would have set, and a caller. */
  function contextFor(
    metadata: Record<string, unknown>,
    user?: { sub: number; sid: number; role: string },
    query: Record<string, unknown> = {},
    body: Record<string, unknown> = {},
  ) {
    const reflector = {
      getAllAndOverride: (key: string) => metadata[key],
    } as unknown as Reflector;
    const request: {
      user?: unknown;
      query: unknown;
      body: unknown;
      ability?: unknown;
    } = {
      user,
      query,
      body,
    };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    return {
      guard: new PoliciesGuard(reflector, new AbilityFactory()),
      context,
      request,
    };
  }

  const policies = (...list: Policy[]) => ({ [CHECK_POLICIES_KEY]: list });

  it('lets a public route through before any work, with no ability', () => {
    const { guard, context, request } = contextFor({ [IS_PUBLIC_KEY]: true });

    expect(guard.canActivate(context)).toBe(true);
    expect(request.ability).toBeUndefined();
  });

  it('refuses a handler that declares no policies at all', () => {
    const { guard, context } = contextFor({}, AS_MANAGER);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('refuses a handler whose policy list is empty', () => {
    const { guard, context } = contextFor(policies(), AS_MANAGER);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('answers 401 to an anonymous caller on a closed route, before the policies', () => {
    const { guard, context } = contextFor(policies(can('read', 'Product')));

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('admits a caller whose ability passes, and puts the ability on the request', () => {
    const { guard, context, request } = contextFor(
      policies(can('manage', 'CartItem')),
      AS_CLIENT,
    );

    expect(guard.canActivate(context)).toBe(true);
    expect(request.ability).toBeDefined();
  });

  it('refuses a caller whose ability fails, with 403', () => {
    const { guard, context } = contextFor(
      policies(can('manage', 'Order')),
      AS_CLIENT,
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('requires every policy, not any', () => {
    const { guard, context } = contextFor(
      policies(can('read', 'Product'), can('manage', 'Order')),
      AS_CLIENT,
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  describe('an optional-auth route', () => {
    const optional = (...list: Policy[]) => ({
      [IS_OPTIONAL_AUTH_KEY]: true,
      ...policies(...list),
    });

    it('admits an anonymous caller whose anonymous ability passes', () => {
      const { guard, context, request } = contextFor(
        optional(can('read', 'Product')),
      );

      expect(guard.canActivate(context)).toBe(true);
      expect(request.ability).toBeDefined();
    });

    it('answers 401, not 403, to an anonymous caller whose policy fails', () => {
      const { guard, context } = contextFor(optional(can('update', 'Product')));

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });

    it('answers 403 to a signed-in caller whose policy fails', () => {
      const { guard, context } = contextFor(
        optional(can('update', 'Product')),
        AS_CLIENT,
      );

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('the named policies', () => {
    it('inactiveProductsNeedManager: the flag is read raw, and the answer follows the caller', () => {
      const flagged = { includeInactive: 'true' };
      const route = {
        [IS_OPTIONAL_AUTH_KEY]: true,
        ...policies(inactiveProductsNeedManager),
      };
      const anonymous = contextFor(route, undefined, flagged);
      const client = contextFor(route, AS_CLIENT, flagged);
      const manager = contextFor(route, AS_MANAGER, flagged);
      const unflagged = contextFor(route, undefined, {});

      expect(() => anonymous.guard.canActivate(anonymous.context)).toThrow(
        UnauthorizedException,
      );
      expect(() => client.guard.canActivate(client.context)).toThrow(
        ForbiddenException,
      );
      expect(manager.guard.canActivate(manager.context)).toBe(true);
      expect(unflagged.guard.canActivate(unflagged.context)).toBe(true);
    });

    it('updateOrCancelOrder: a client reaches the route to cancel, a manager to advance, a delivery person to deliver', () => {
      const client = contextFor(policies(updateOrCancelOrder), AS_CLIENT);
      const manager = contextFor(policies(updateOrCancelOrder), AS_MANAGER);
      const delivery = contextFor(policies(updateOrCancelOrder), AS_DELIVERY);

      expect(client.guard.canActivate(client.context)).toBe(true);
      expect(manager.guard.canActivate(manager.context)).toBe(true);
      expect(delivery.guard.canActivate(delivery.context)).toBe(true);
    });

    /**
     * The third verb earns its place. A delivery person also holds `cancel` on
     * their own orders, so the route would open for them without it, and this
     * case would pass either way. Asked of the ability directly, so what is
     * pinned is the verb the role actually brings.
     */
    it('updateOrCancelOrder: the delivery person is admitted by deliver, not by update', () => {
      const ability = new AbilityFactory().for(AS_DELIVERY);

      expect(ability.can('deliver', 'Order')).toBe(true);
      expect(ability.can('update', 'Order')).toBe(false);
    });

    it('placeOrder: a client reaches the route with a code and without one', () => {
      const plain = contextFor(policies(placeOrder), AS_CLIENT);
      const coded = contextFor(
        policies(placeOrder),
        AS_CLIENT,
        {},
        { promoCode: 'SAVE10' },
      );

      expect(plain.guard.canActivate(plain.context)).toBe(true);
      expect(coded.guard.canActivate(coded.context)).toBe(true);
    });

    /**
     * The false branch the 403 on `createOrder` rests on.
     *
     * Every role the factory builds holds `apply PromoCode`, so no context the
     * guard can be given reaches this branch, and the ability is built by hand
     * the way the delivery person's verbs are asked directly above. What is
     * pinned is that the second half of the policy is load bearing: an ability
     * that may place an order and may not apply a code is refused exactly when
     * the body names one, and the body is read raw, as the guard sees it.
     * ADR 37.
     */
    it('placeOrder: the apply verb is what a body naming a code needs', () => {
      const builder = new AbilityBuilder<AppAbility>(createPrismaAbility);
      builder.can('create', 'Order');
      const withoutApply = builder.build();
      const withApply = new AbilityFactory().for(AS_CLIENT);

      const bodyOf = (body: Record<string, unknown>) =>
        ({ body }) as unknown as Request;

      expect(placeOrder(withoutApply, bodyOf({}))).toBe(true);
      expect(placeOrder(withoutApply, bodyOf({ promoCode: 'SAVE10' }))).toBe(
        false,
      );
      expect(placeOrder(withApply, bodyOf({ promoCode: 'SAVE10' }))).toBe(true);
    });
  });
});
