import { Injectable } from '@nestjs/common';
import { AbilityBuilder } from '@casl/ability';
import type { AccessTokenPayload } from '../auth/access-token-payload';
import { createPrismaAbility } from './casl-prisma';
import type { AppAbility } from './ability';

/**
 * The abilities, one factory, three callers. Brief section 6.
 *
 * - Anyone, signed in or not, reads the catalog: products on sale, variants,
 *   categories. That is the anonymous ability, and the condition on `Product`
 *   is the visibility rule `product-visibility.ts` states for a shopper.
 * - A signed-in caller manages their own cart and their own likes, creates
 *   orders, and reads, cancels and pays their own; they also manage their own
 *   sessions and update their own account. The delivery person has exactly this until the
 *   optional delivery feature exists, because the contract gives that role no
 *   operation of its own.
 * - A manager, on top of that, reads every product that is not deleted,
 *   writes the catalog, and manages every order: the brief's "view all
 *   orders" and "update order status" are `manage Order`, unconditional.
 *
 * The conditions are Prisma where clauses, so the same rule that answers
 * `ability.can('read', subject('Order', row))` also answers
 * `accessibleBy(ability).Order`, and a service filters with the rule instead
 * of restating it.
 */
@Injectable()
export class AbilityFactory {
  for(viewer: AccessTokenPayload | undefined): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createPrismaAbility);

    can('read', 'Product', { deletedAt: null, isActive: true });
    can('read', 'ProductVariant');
    can('read', 'Category');

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

    if (viewer.role === 'manager') {
      can('read', 'Product', { deletedAt: null });
      can(['create', 'update', 'delete'], 'Product');
      can('manage', 'ProductVariant');
      can('manage', 'Order');
    }

    return build();
  }
}
