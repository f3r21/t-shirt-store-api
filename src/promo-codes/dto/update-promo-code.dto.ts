import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { INT4_MAX } from '../../common/int4';
import { IsOptionalNotNull } from '../../common/is-optional-not-null';
import { PromoDiscountType } from '../../generated/prisma/enums';
import { PROMO_DISCOUNT_TYPES } from './promo-code.dto';
import { PercentageAtMost100 } from './percentage-at-most-100';

/**
 * Validate the discount pair when the body names either half of it.
 *
 * The two fields are one value: `discount_value` holds a percentage under one
 * type and an amount in minor units under the other. A value with no type
 * would turn a fixed 500 into 500 percent, and a type with no value would do
 * the same the other way, so neither half can be checked alone. When both are
 * absent the pair is not being changed and both validators stand down.
 */
const DiscountPairIsWhole = (): PropertyDecorator =>
  ValidateIf((object: unknown) => {
    const { discountType, discountValue } = object as UpdatePromoCodeDto;
    return discountType !== undefined || discountValue !== undefined;
  });

/**
 * Request body of `updatePromoCode`. `isActive` false disables the code and
 * true enables it again, which is the brief's switch. `minProperties: 1` is
 * enforced by `NonEmptyBodyPipe`, and every optional property carries
 * `@IsOptionalNotNull` or the pair rule above.
 *
 * `usedCount` is not here. Checkout is the only writer of that column, so a
 * manager who sends it reads a 400 from the pipe rather than resetting it.
 */
export class UpdatePromoCodeDto {
  @IsOptionalNotNull()
  @IsString({ message: 'must be a string' })
  @MinLength(1, { message: 'must be at least 1 character' })
  @MaxLength(40, { message: 'must be at most 40 characters' })
  code?: string;

  /** Send this field together with `discountValue`. */
  @ApiPropertyOptional({ enum: PROMO_DISCOUNT_TYPES })
  @DiscountPairIsWhole()
  @IsIn(PROMO_DISCOUNT_TYPES, { message: 'must be one of percentage, fixed' })
  discountType?: PromoDiscountType;

  /** Send this field together with `discountType`. */
  @DiscountPairIsWhole()
  @IsInt({ message: 'must be an integer' })
  @Min(1, { message: 'must be at least 1' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  @Validate(PercentageAtMost100)
  discountValue?: number;

  @IsOptionalNotNull()
  @IsISO8601({ strict: true }, { message: 'must be an ISO 8601 date-time' })
  expiresAt?: string;

  @IsOptionalNotNull()
  @IsInt({ message: 'must be an integer' })
  @Min(1, { message: 'must be at least 1' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  usageLimit?: number;

  @IsOptionalNotNull()
  @IsInt({ message: 'must be an integer' })
  @Min(0, { message: 'must be at least 0' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  minPurchase?: number;

  /** Set this field to false to disable the code. */
  @IsOptionalNotNull()
  @IsBoolean({ message: 'must be a boolean' })
  isActive?: boolean;
}
