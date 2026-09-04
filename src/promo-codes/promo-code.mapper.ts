import type { PromoCode as PromoCodeRow } from '../generated/prisma/client';
import type { PromoCodeDto } from './dto/promo-code.dto';

/**
 * Map one row to the contract's `PromoCode`.
 *
 * Every field is named, so a column the table grows later has no path to a
 * response. The three nullable rules become absent members rather than nulls,
 * because the contract declares no nullable field, and `min_purchase_cents`
 * loses its suffix on the way out, the same split `price_cents` makes.
 */
export function toPromoCodeDto(row: PromoCodeRow): PromoCodeDto {
  const dto: PromoCodeDto = {
    id: row.id,
    code: row.code,
    discountType: row.discountType,
    discountValue: row.discountValue,
    usedCount: row.usedCount,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };

  if (row.expiresAt !== null) {
    dto.expiresAt = row.expiresAt.toISOString();
  }
  if (row.usageLimit !== null) {
    dto.usageLimit = row.usageLimit;
  }
  if (row.minPurchaseCents !== null) {
    dto.minPurchase = row.minPurchaseCents;
  }

  return dto;
}
