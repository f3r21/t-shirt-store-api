import { IsInt, Max, Min } from 'class-validator';
import { INT4_MAX } from '../../common/int4';

/**
 * Request body of PUT /users/me/cart/items/{variantId}. See
 * `openapi.yaml:1308-1340`.
 *
 * The value is absolute. Two identical calls leave the same quantity, so a
 * repeat on a slow connection cannot double the line. Zero is not a quantity
 * to hold: the contract says to send a DELETE instead, so the minimum is one.
 *
 * The upper bound is the `int4` ceiling of the column.
 */
export class SetCartItemDto {
  @IsInt({ message: 'must be an integer' })
  @Min(1, { message: 'must be at least 1' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  quantity!: number;
}
