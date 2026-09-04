import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsOptionalNotNull } from '../../common/is-optional-not-null';

/**
 * Request body of `createOrder`, and every member of it is optional, so a
 * checkout at full price sends no body at all.
 *
 * The two lengths are the ones `CreatePromoCodeDto` puts on the column, so a
 * value no code could hold is a 400 here and never reaches the table. A code
 * that is well formed and refused is a 422 from the service, because the body
 * is valid and the content is what fails.
 */
export class CreateOrderDto {
  /** The promo code to apply. The server compares it without case. */
  @IsOptionalNotNull()
  @IsString({ message: 'must be a string' })
  @MinLength(1, { message: 'must be at least 1 character' })
  @MaxLength(40, { message: 'must be at most 40 characters' })
  promoCode?: string;
}
