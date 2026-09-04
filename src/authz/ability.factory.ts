import { Injectable } from '@nestjs/common';
import { AbilityBuilder } from '@casl/ability';
import type { AccessTokenPayload } from '../auth/access-token-payload';
import { createPrismaAbility } from './casl-prisma';
import type { AppAbility } from './ability';

/**
 * The abilities, one factory: the catalog for anyone, own cart, likes, orders
 * and sessions for a signed-in caller, the catalog writes and every order for
 * a manager. The conditions are Prisma where clauses, so `accessibleBy` reads
 * the same rule the guard checks. ADR 25.
 */
@Injectable()
export class AbilityFactory {
  for(viewer: AccessTokenPayload | undefined): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createPrismaAbility);

    can('read', 'Product', { deletedAt: null, isActive: true });

    if (viewer === undefined) {
      return build();
    }

    const userId = viewer.sub;
    can('manage', 'CartItem', { userId });
    can('manage', 'ProductLike', { userId });
    can('create', 'Order');
    can(['read', 'cancel', 'pay'], 'Order', { userId });
    can('manage', 'RefreshToken', { userId });
    can('update', 'User', { id: userId });
    // The brief's "Client can apply promo codes to own orders". No condition:
    // the subject is the code and not the order, and the order this reaches is
    // the caller's own by `create Order` above. It grants nothing else, so a
    // client still cannot read, create or change a code. ADR 37.
    can('apply', 'PromoCode');

    // After the signed-in block, because a delivery person is also a user with
    // a cart and orders of their own. That is why the two verbs differ: `read`
    // is what this caller may open, own purchases included, and `deliver` is
    // the round, which is what `listDeliveries` scopes on. Scoping the list on
    // `read` would put an order this courier bought, and a colleague
    // delivered, in their own delivery history. ADR 36.
    if (viewer.role === 'delivery_person') {
      can('read', 'Order', { status: 'shipped' });
      can('read', 'Order', { status: 'delivered', deliveredById: userId });
      can('deliver', 'Order', { status: 'shipped' });
      can('deliver', 'Order', { status: 'delivered', deliveredById: userId });
    }

    if (viewer.role === 'manager') {
      can('read', 'Product', { deletedAt: null });
      can(['create', 'update', 'delete'], 'Product');
      can('manage', 'ProductVariant');
      can('manage', 'Order');
      // The whole of Optional Feature 13 on the manager's side, and no rule
      // for anyone else: a client meets a code at checkout, by sending it, and
      // never reads this subject.
      can('manage', 'PromoCode');
    }

    return build();
  }
}
