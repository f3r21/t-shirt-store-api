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

    if (viewer.role === 'manager') {
      can('read', 'Product', { deletedAt: null });
      can(['create', 'update', 'delete'], 'Product');
      can('manage', 'ProductVariant');
      can('manage', 'Order');
    }

    return build();
  }
}
