import { IsInt, Max, Min } from 'class-validator';
import { INT4_MAX } from '../../common/int4';

/**
 * Request body of `setCartItem`. The value is absolute, so a repeat cannot
 * double the line, and zero is a DELETE, so the minimum is one.
 */
export class SetCartItemDto {
  @IsInt({ message: 'must be an integer' })
  @Min(1, { message: 'must be at least 1' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  quantity!: number;
}
