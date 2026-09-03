import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { INT4_MAX } from '../../common/int4';
import { IsOptionalNotNull } from '../../common/is-optional-not-null';

/**
 * Request body of `updateVariant`. No `stock`: it has its own operation,
 * because the webhook writes it too, and `whitelist` drops it here.
 * `minProperties: 1` is enforced by `NonEmptyBodyPipe`.
 */
export class UpdateVariantDto {
  @IsOptionalNotNull()
  @IsString({ message: 'must be a string' })
  @MaxLength(20, { message: 'must be at most 20 characters' })
  size?: string;

  @IsOptionalNotNull()
  @IsString({ message: 'must be a string' })
  @MaxLength(40, { message: 'must be at most 40 characters' })
  color?: string;

  /** An amount in minor units. 1999 means 19.99. */
  @IsOptionalNotNull()
  @IsInt({ message: 'must be an integer' })
  @Min(0, { message: 'must be at least 0' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  price?: number;
}
