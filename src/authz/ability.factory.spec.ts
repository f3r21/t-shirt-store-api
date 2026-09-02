import { subject } from '@casl/ability';
import { accessibleBy } from '@casl/prisma';
import type {
  ProductLike,
  RefreshToken,
  User,
} from '../generated/prisma/client';
import { AbilityFactory } from './ability.factory';
import { AS_CLIENT, AS_MANAGER, aProduct } from '../products/products.fixtures';
import { anOrder } from '../orders/orders.fixtures';
import { aCartRow } from '../cart/cart.fixtures';

const AS_DELIVERY = { sub: 77, sid: 3, role: 'delivery_person' };

/** A session row, as the ability sees it: only `userId` matters to the rules. */
const aSession = (userId: number): RefreshToken => ({
  id: 1,
  userId,
  tokenHash: 'hash',
  previousTokenHash: null,
  deviceName: null,
  expiresAt: new Date('2026-09-08T00:00:00.000Z'),
  rotatedAt: null,
  familyId: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
});

/** A like row: the pair is the whole fact, and only `userId` matters here. */
const aLike = (userId: number): ProductLike => ({ userId, variantId: 340 });

/** An account row, as the ability sees it: only `id` matters to the rules. */
const anAccount = (id: number): User => ({
  id,
  email: 'someone@example.com',
  passwordHash: 'hash',
  firstName: 'Some',
  lastName: 'One',
  roleId: 2,
  resetTokenHash: null,
  resetTokenExpiresAt: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
});

/**
 * The grants and the denials, per caller, and the where clauses the rules
 * turn into. The where shapes are pinned here because three services rely on
 * them: `{ OR: [condition] }` for a conditional rule, `{}` for an
 * unconditional one, and a throw where no rule allows the action at all.
 *
 * Instance checks go through `subject()`, because a Prisma row is a plain
 * object and CASL cannot tell an order from a product without being told.
 */
describe('AbilityFactory', () => {
  const factory = new AbilityFactory();

  describe('anyone, signed in or not', () => {
    const ability = factory.for(undefined);

    it('reads the catalog: products on sale, variants, categories', () => {
      expect(ability.can('read', 'Product')).toBe(true);
      expect(ability.can('read', 'ProductVariant')).toBe(true);
      expect(ability.can('read', 'Category')).toBe(true);
    });

    it('reads a product only when it is active and not deleted', () => {
      const read = (overrides: Partial<ReturnType<typeof aProduct>>) =>
        ability.can('read', subject('Product', aProduct(overrides)));

      expect(read({})).toBe(true);
      expect(read({ isActive: false })).toBe(false);
      expect(read({ deletedAt: new Date() })).toBe(false);
    });

    it('turns that rule into the shopper visibility where', () => {
      expect(accessibleBy(ability).Product).toEqual({
        OR: [{ deletedAt: null, isActive: true }],
      });
    });

    it('does nothing else', () => {
      expect(ability.can('create', 'Product')).toBe(false);
      expect(ability.can('manage', 'CartItem')).toBe(false);
      expect(ability.can('manage', 'ProductLike')).toBe(false);
      expect(ability.can('create', 'Order')).toBe(false);
      expect(ability.can('read', 'Order')).toBe(false);
      expect(() => accessibleBy(ability).Order).toThrow();
    });
  });

  describe('a client', () => {
    const ability = factory.for(AS_CLIENT);
    const own = subject('Order', anOrder({ userId: 128 }));
    const other = subject('Order', anOrder({ userId: 7 }));

    it('manages their own cart and nobody else', () => {
      expect(ability.can('manage', 'CartItem')).toBe(true);
      expect(
        ability.can('read', subject('CartItem', aCartRow({ userId: 128 }))),
      ).toBe(true);
      expect(
        ability.can('read', subject('CartItem', aCartRow({ userId: 7 }))),
      ).toBe(false);
    });

    it('manages their own likes and nobody else, as a where on user id', () => {
      expect(ability.can('manage', 'ProductLike')).toBe(true);
      expect(ability.can('delete', subject('ProductLike', aLike(128)))).toBe(
        true,
      );
      expect(ability.can('delete', subject('ProductLike', aLike(7)))).toBe(
        false,
      );
      expect(accessibleBy(ability).ProductLike).toEqual({
        OR: [{ userId: 128 }],
      });
    });

    it('creates orders, and reads, cancels and pays their own', () => {
      expect(ability.can('create', 'Order')).toBe(true);
      expect(ability.can('read', own)).toBe(true);
      expect(ability.can('cancel', own)).toBe(true);
      expect(ability.can('pay', own)).toBe(true);
      expect(ability.can('read', other)).toBe(false);
      expect(ability.can('cancel', other)).toBe(false);
      expect(ability.can('pay', other)).toBe(false);
    });

    it('neither advances an order nor sees every order', () => {
      expect(ability.can('update', 'Order')).toBe(false);
      // The type-level read is true, because some orders are theirs. The
      // manager-only list asks for `manage`, which only a manage rule grants.
      expect(ability.can('read', 'Order')).toBe(true);
      expect(ability.can('manage', 'Order')).toBe(false);
    });

    it('turns own into a where on user id, for each verb', () => {
      const mine = { OR: [{ userId: 128 }] };
      expect(accessibleBy(ability, 'read').Order).toEqual(mine);
      expect(accessibleBy(ability, 'cancel').Order).toEqual(mine);
      expect(accessibleBy(ability, 'pay').Order).toEqual(mine);
    });

    it('does not write the catalog', () => {
      expect(ability.can('create', 'Product')).toBe(false);
      expect(ability.can('update', 'Product')).toBe(false);
      expect(ability.can('delete', 'Product')).toBe(false);
      expect(ability.can('manage', 'ProductVariant')).toBe(false);
    });

    it('manages their own sessions and updates their own account', () => {
      expect(
        ability.can('delete', subject('RefreshToken', aSession(128))),
      ).toBe(true);
      expect(ability.can('delete', subject('RefreshToken', aSession(7)))).toBe(
        false,
      );
      expect(ability.can('update', subject('User', anAccount(128)))).toBe(true);
      expect(ability.can('update', subject('User', anAccount(7)))).toBe(false);
    });
  });

  describe('a delivery person', () => {
    it('has exactly what a client has, until the delivery feature exists', () => {
      const ability = factory.for(AS_DELIVERY);

      expect(ability.can('manage', 'CartItem')).toBe(true);
      expect(
        ability.can('read', subject('Order', anOrder({ userId: 77 }))),
      ).toBe(true);
      expect(ability.can('update', 'Order')).toBe(false);
      expect(ability.can('manage', 'Order')).toBe(false);
      expect(ability.can('create', 'Product')).toBe(false);
    });
  });

  describe('a manager', () => {
    const ability = factory.for(AS_MANAGER);

    it('writes the catalog', () => {
      expect(ability.can('create', 'Product')).toBe(true);
      expect(ability.can('update', 'Product')).toBe(true);
      expect(ability.can('delete', 'Product')).toBe(true);
      expect(ability.can('manage', 'ProductVariant')).toBe(true);
    });

    it('reads a disabled product, and still not a deleted one', () => {
      expect(
        ability.can('read', subject('Product', aProduct({ isActive: false }))),
      ).toBe(true);
      expect(
        ability.can(
          'read',
          subject('Product', aProduct({ deletedAt: new Date() })),
        ),
      ).toBe(false);
      expect(accessibleBy(ability).Product).toEqual({
        OR: [{ deletedAt: null }, { deletedAt: null, isActive: true }],
      });
    });

    it('manages every order: the list, the advance, and any cancel', () => {
      expect(ability.can('manage', 'Order')).toBe(true);
      expect(ability.can('update', 'Order')).toBe(true);
      expect(
        ability.can('cancel', subject('Order', anOrder({ userId: 7 }))),
      ).toBe(true);
      expect(accessibleBy(ability, 'read').Order).toEqual({});
      expect(accessibleBy(ability, 'pay').Order).toEqual({});
    });

    it('still manages only their own cart and their own likes', () => {
      expect(
        ability.can('read', subject('CartItem', aCartRow({ userId: 1 }))),
      ).toBe(true);
      expect(
        ability.can('read', subject('CartItem', aCartRow({ userId: 7 }))),
      ).toBe(false);
      expect(ability.can('delete', subject('ProductLike', aLike(1)))).toBe(
        true,
      );
      expect(ability.can('delete', subject('ProductLike', aLike(7)))).toBe(
        false,
      );
    });
  });
});
