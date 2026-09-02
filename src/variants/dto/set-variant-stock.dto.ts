import { IsInt, Max, Min } from 'class-validator';
import { INT4_MAX } from '../../common/int4';

/**
 * Request body of PATCH /variants/{id}/stock. See `openapi.yaml:1096-1108`.
 *
 * The stock has its own operation and its own body, because the payment webhook
 * writes the same column.
 *
 * The upper bound is the `int4` ceiling of that column, for the reason
 * `create-variant.dto.ts` records.
 */
export class SetVariantStockDto {
  /** The units on hand after this call. */
  @IsInt({ message: 'must be an integer' })
  @Min(0, { message: 'must be at least 0' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  stock!: number;
}
