import type { PromoCode as PromoCodeRow } from '../generated/prisma/client';

/**
 * A fixed row, so two calls in one test return the same values and an
 * assertion on an id is explicit. Pass `overrides` for the field under test.
 *
 * The three rules are absent by default, which is the state a code created
 * from the smallest body is in.
 */
export function aPromoCode(
  overrides: Partial<PromoCodeRow> = {},
): PromoCodeRow {
  return {
    id: 4,
    code: 'SAVE10',
    discountType: 'percentage',
    discountValue: 10,
    expiresAt: null,
    usageLimit: null,
    usedCount: 0,
    minPurchaseCents: null,
    isActive: true,
    createdAt: new Date('2026-09-04T10:15:00.000Z'),
    ...overrides,
  };
}
