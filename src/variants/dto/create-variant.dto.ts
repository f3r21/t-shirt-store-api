import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { INT4_MAX } from '../../common/int4';
import { IsOptionalNotNull } from '../../common/is-optional-not-null';

/**
 * Request body of `createVariant`. Messages omit the field name, because
 * `Problem.errors[].field` carries it. `size` and `color` have no minimum.
 * `price` and `stock` carry the `int4` bound the contract never restates.
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
