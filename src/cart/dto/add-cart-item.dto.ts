import { IsInt, Max, Min } from 'class-validator';
import { INT4_MAX } from '../../common/int4';

/**
 * Request body of `addCartItem`. `quantity` is an amount to add, one or more;
 * `setCartItem` is the absolute form. Each message omits the field name,
 * because `Problem.errors[].field` carries it.
 */
export class AddCartItemDto {
  @IsInt({ message: 'must be an integer' })
  @Min(1, { message: 'must be at least 1' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  variantId!: number;

  @IsInt({ message: 'must be an integer' })
  @Min(1, { message: 'must be at least 1' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  quantity!: number;
}
