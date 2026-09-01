import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { INT4_MAX } from '../../common/int4';
import { IsOptionalNotNull } from '../../common/is-optional-not-null';

/**
 * Request body of POST /products/{id}/variants. See `openapi.yaml:950-973`.
 *
 * Each message omits the field name, because `Problem.errors[].field` carries
 * it.
 *
 * The contract sets no minimum length on `size` or on `color`, so an empty
 * string passes both.
 *
 * The contract sets no upper bound on `price` or on `stock` either, and this
 * class does, because `price_cents` and `stock` are `int4` columns. Measured
 * before the bound existed: the pipe accepted 2147483648 for both fields, and
 * Postgres answered `P2020`, which nothing maps, which left a 500. The bound
 * belongs to the storage layer and the contract never restated it.
 */
export class CreateVariantDto {
  @IsOptionalNotNull()
  @IsString({ message: 'must be a string' })
  @MaxLength(20, { message: 'must be at most 20 characters' })
  size?: string;

  @IsOptionalNotNull()
  @IsString({ message: 'must be a string' })
  @MaxLength(40, { message: 'must be at most 40 characters' })
  color?: string;

  /** An amount in minor units. 1999 means 19.99. */
  @IsInt({ message: 'must be an integer' })
  @Min(0, { message: 'must be at least 0' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  price!: number;

  @IsInt({ message: 'must be an integer' })
  @Min(0, { message: 'must be at least 0' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  stock!: number;
}
