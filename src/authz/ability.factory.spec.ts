import { subject } from '@casl/ability';
import { accessibleBy } from '@casl/prisma';
import type {
  ProductLike,
  RefreshToken,
  User,
} from '../generated/prisma/client';
import { AbilityFactory } from './ability.factory';
import { AS_DELIVERY } from './authz.fixtures';
import { AS_CLIENT, AS_MANAGER, aProduct } from '../products/products.fixtures';
import { anOrder } from '../orders/orders.fixtures';
import { aCartRow } from '../cart/cart.fixtures';

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

    it('reads products on sale; variants and categories have no rule of their own', () => {
      expect(ability.can('read', 'Product')).toBe(true);
      // Written by hand, 2026-09-03. Variants and categories are read through
      // their product and no route names either subject, so an unconditional
      // rule here was a trap for the first route that would trust it.
      expect(ability.can('read', 'ProductVariant')).toBe(false);
      expect(ability.can('read', 'Category')).toBe(false);
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
      expect(ability.can('read', 'PromoCode')).toBe(false);
      expect(ability.can('apply', 'PromoCode')).toBe(false);
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

    /**
     * A client holds one verb on a promo code and only one: `apply`, which is
     * the brief's own word for sending a code at checkout. The three manager
     * operations stay closed, so `read` is false and not a rule with a
     * condition: a client never opens a code, it names one. ADR 37.
     */
    it('applies a promo code, and neither reads nor writes one', () => {
      expect(ability.can('apply', 'PromoCode')).toBe(true);
      expect(ability.can('read', 'PromoCode')).toBe(false);
      expect(ability.can('create', 'PromoCode')).toBe(false);
      expect(ability.can('update', 'PromoCode')).toBe(false);
      expect(ability.can('manage', 'PromoCode')).toBe(false);
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
    const ability = factory.for(AS_DELIVERY);

    // Someone else's orders, in the four statuses the two delivery rules
    // divide: the queue, one this person delivered, one another delivery
    // person delivered, and one that has not shipped.
    const shipped = subject('Order', anOrder({ userId: 7, status: 'shipped' }));
    const deliveredByMe = subject(
      'Order',
      anOrder({ userId: 7, status: 'delivered', deliveredById: 77 }),
    );
    const deliveredByAnother = subject(
      'Order',
      anOrder({ userId: 7, status: 'delivered', deliveredById: 91 }),
    );
    const pending = subject('Order', anOrder({ userId: 7, status: 'pending' }));

    it('may deliver a shipped order and nothing else a client cannot', () => {
      expect(ability.can('deliver', shipped)).toBe(true);
      expect(ability.can('read', shipped)).toBe(true);

      // The rest of the order verbs stay where a client leaves them. A
      // delivery person advances nothing, cancels nothing that is not theirs,
      // and reads no order that is neither theirs nor on the round.
      expect(ability.can('update', 'Order')).toBe(false);
      expect(ability.can('manage', 'Order')).toBe(false);
      expect(ability.can('cancel', shipped)).toBe(false);
      expect(ability.can('pay', shipped)).toBe(false);
      expect(ability.can('read', pending)).toBe(false);
      expect(ability.can('create', 'Product')).toBe(false);
    });

    // `deliver` is the round, past and present, because it is what the
    // delivery list scopes on: a delivered order stays in reach of the person
    // who delivered it and of nobody else. Sending `delivered` on it a second
    // time is the transition table's 409, not a 403.
    it('holds deliver over its own round, and over no other order', () => {
      expect(ability.can('deliver', shipped)).toBe(true);
      expect(ability.can('deliver', deliveredByMe)).toBe(true);
      expect(ability.can('deliver', deliveredByAnother)).toBe(false);
      expect(ability.can('deliver', pending)).toBe(false);
    });

    it('reads a delivered order only when it delivered it', () => {
      expect(ability.can('read', deliveredByMe)).toBe(true);
      expect(ability.can('read', deliveredByAnother)).toBe(false);
    });

    it('is still a user, with a cart and orders of its own', () => {
      expect(ability.can('manage', 'CartItem')).toBe(true);
      expect(ability.can('create', 'Order')).toBe(true);
      expect(
        ability.can('cancel', subject('Order', anOrder({ userId: 77 }))),
      ).toBe(true);
    });

    // The branches come back in reverse declaration order, which is CASL's own
    // and is what the manager's `Product` case above already pins: the rule
    // written last is the first branch. Asserted as written and not sorted,
    // because a silent reordering would mean the rules moved.
    it('turns the three read rules into the where the two lists share', () => {
      expect(accessibleBy(ability, 'read').Order).toEqual({
        OR: [
          { status: 'delivered', deliveredById: 77 },
          { status: 'shipped' },
          { userId: 77 },
        ],
      });
      // The delivery list scopes on this one and not on the read above. The
      // read set carries the caller's own purchases, so an order this person
      // bought and a colleague delivered would land in their own history.
      expect(accessibleBy(ability, 'deliver').Order).toEqual({
        OR: [{ status: 'delivered', deliveredById: 77 }, { status: 'shipped' }],
      });
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

    it('manages the promo codes: creates one, reads the list, disables one', () => {
      expect(ability.can('manage', 'PromoCode')).toBe(true);
      expect(ability.can('create', 'PromoCode')).toBe(true);
      expect(ability.can('read', 'PromoCode')).toBe(true);
      expect(ability.can('update', 'PromoCode')).toBe(true);
      // `manage` is CASL's alias for every action, so the manager reaches
      // checkout's verb through the one rule and needs none of its own.
      expect(ability.can('apply', 'PromoCode')).toBe(true);
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
