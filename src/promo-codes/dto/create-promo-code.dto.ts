import {
  IsIn,
  IsInt,
  IsISO8601,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { INT4_MAX } from '../../common/int4';
import { IsOptionalNotNull } from '../../common/is-optional-not-null';
import { PromoDiscountType } from '../../generated/prisma/enums';
import { PROMO_DISCOUNT_TYPES } from './promo-code.dto';
import { PercentageAtMost100 } from './percentage-at-most-100';

/**
 * Request body of `createPromoCode`. Messages omit the field name, because
 * `Problem.errors[].field` carries it. A code another row already holds is a
 * 409 from the unique index; every rule here is a 400.
 *
 * `isActive` is absent on purpose. The column defaults to true and the switch
 * belongs to `updatePromoCode`, so a create cannot ship a disabled code.
 */
export class CreatePromoCodeDto {
  /** The value a client sends at checkout. The server compares it without case. */
  @IsString({ message: 'must be a string' })
  @MinLength(1, { message: 'must be at least 1 character' })
  @MaxLength(40, { message: 'must be at most 40 characters' })
  code!: string;

  @ApiProperty({ enum: PROMO_DISCOUNT_TYPES })
  @IsIn(PROMO_DISCOUNT_TYPES, { message: 'must be one of percentage, fixed' })
  discountType!: PromoDiscountType;

  /** A percentage from 1 to 100, or an amount in minor units. */
  @IsInt({ message: 'must be an integer' })
  @Min(1, { message: 'must be at least 1' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  @Validate(PercentageAtMost100)
  discountValue!: number;

  /** The instant the server stops accepting this code. */
  @IsOptionalNotNull()
  @IsISO8601({ strict: true }, { message: 'must be an ISO 8601 date-time' })
  expiresAt?: string;

  /** The number of orders that may use this code in total. */
  @IsOptionalNotNull()
  @IsInt({ message: 'must be an integer' })
  @Min(1, { message: 'must be at least 1' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  usageLimit?: number;

  /** The smallest order subtotal this code applies to, in minor units. */
  @IsOptionalNotNull()
  @IsInt({ message: 'must be an integer' })
  @Min(0, { message: 'must be at least 0' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  minPurchase?: number;
}
