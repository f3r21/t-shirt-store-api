import type { Prisma } from '../generated/prisma/client';
import type { AccessTokenPayload } from '../auth/access-token-payload';

export function isManager(viewer: AccessTokenPayload | undefined): boolean {
  return viewer?.role === 'manager';
}

/**
 * Never relaxed, for any caller.
 *
 * A deleted product is 404 for everyone, a manager included. Delete is soft
 * because order history points at the variants of products that may since have
 * been withdrawn, so the row has to survive while the catalog stops showing it.
 */
export const NOT_DELETED = { deletedAt: null } as const;

/**
 * The three-way visibility rule: deleted is 404 for everyone, disabled is 404
 * unless a manager asked, active is public. The catalog reads take it from
 * the ability; the cart and the checkout call it for "on sale". The writes
 * use `NOT_DELETED` alone. ADR 15, ADR 25.
 */
export function visibleProductWhere(
  viewer: AccessTokenPayload | undefined,
  includeInactive = false,
): Prisma.ProductWhereInput {
  return isManager(viewer) && includeInactive
    ? { ...NOT_DELETED }
    : { ...NOT_DELETED, isActive: true };
}
