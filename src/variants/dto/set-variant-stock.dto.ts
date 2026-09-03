import { IsInt, Max, Min } from 'class-validator';
import { INT4_MAX } from '../../common/int4';

/**
 * Request body of `setVariantStock`. Its own operation, because the webhook
 * writes the same column.
 */
export class SetVariantStockDto {
  /** The units on hand after this call. */
  @IsInt({ message: 'must be an integer' })
  @Min(0, { message: 'must be at least 0' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  stock!: number;
}
