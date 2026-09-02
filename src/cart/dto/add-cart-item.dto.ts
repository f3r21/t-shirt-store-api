import { IsInt, Max, Min } from 'class-validator';
import { INT4_MAX } from '../../common/int4';

/**
 * Request body of POST /users/me/cart/items. See `openapi.yaml:1241-1277`.
 *
 * `quantity` is an amount to add and not the quantity wanted, in the contract's
 * own words. One or more: adding nothing is not a request the server needs to
 * answer, and removing a line is a DELETE. `PUT /users/me/cart/items/{variantId}`
 * is the absolute form.
 *
 * Each message omits the field name, because `Problem.errors[].field` carries
 * it. The upper bound is the `int4` ceiling of both columns, the way every id
 * and count body in this repository bounds them.
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
