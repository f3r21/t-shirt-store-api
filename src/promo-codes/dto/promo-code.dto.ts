import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { PromoDiscountType } from '../../generated/prisma/enums';

/** The two kinds, for the document and for `@IsIn`. The generated enum is the source. */
export const PROMO_DISCOUNT_TYPES = Object.values(PromoDiscountType);

/**
 * The contract's `PromoCode`. The three optional members are the three rules a
 * code may carry, and each is absent when the column is null, because the
 * contract declares no nullable field.
 */
@ApiSchema({ name: 'PromoCode' })
export class PromoCodeDto {
  id!: number;

  /** The value a client sends at checkout, in the case the manager typed. */
  code!: string;

  @ApiProperty({ enum: PROMO_DISCOUNT_TYPES })
  discountType!: PromoDiscountType;

  /**
   * A percentage from 1 to 100, or an amount in minor units. `discountType`
   * decides which one.
   */
  discountValue!: number;

  /** ISO 8601. Absent when the code does not expire. */
  expiresAt?: string;

  /** The orders that may use this code in total. Absent when there is no limit. */
  usageLimit?: number;

  /** The number of orders that have used this code. */
  usedCount!: number;

  /**
   * The smallest order subtotal this code applies to, in minor units. Absent
   * when the code applies to any subtotal.
   */
  minPurchase?: number;

  /** A disabled code returns an error at checkout. It stays in the list. */
  isActive!: boolean;

  /** ISO 8601. The mapper converts the `Date` the database returns. */
  createdAt!: string;
}
