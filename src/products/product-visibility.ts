import { Prisma } from '../generated/prisma/client';
import { AccessTokenPayload } from '../auth/access-token-payload';

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
 * The three-way visibility rule, in one place.
 *
 * Deleted is 404 for everyone. Disabled is 404 unless the caller is a manager
 * who asked for it. Active is public. Writing it once is the point: the same
 * predicate has to hold on the list and on the detail read, and two copies
 * would drift.
 *
 * The writes do not call this. `updateProduct` and `deleteProduct` are manager
 * only and resolve through `assertProductExists`, which filters on
 * `NOT_DELETED` alone, so a manager can still update a product they disabled.
 * `NOT_DELETED` is the half those paths share, and the variant lookups share it
 * too, which is why it is exported on its own.
 */
export function visibleProductWhere(
  viewer: AccessTokenPayload | undefined,
  includeInactive = false,
): Prisma.ProductWhereInput {
  return isManager(viewer) && includeInactive
    ? { ...NOT_DELETED }
    : { ...NOT_DELETED, isActive: true };
}
