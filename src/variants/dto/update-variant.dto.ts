import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Request body of PATCH /variants/{id}. See `openapi.yaml:1014-1032`.
 *
 * The body carries no `stock`. The contract gives the stock its own operation,
 * because the payment webhook writes that value too. A request that sends
 * `stock` here loses it to `whitelist: true`, which `src/common/validation-pipe-options.ts:17` sets.
 *
 * The contract also declares `minProperties: 1`. This class does not enforce
 * that rule and cannot. `NonEmptyBodyPipe` does, and the reason it is a pipe
 * rather than a validator is recorded in `update-product.dto.ts`.
 */
export class UpdateVariantDto {
  @IsOptional()
  @IsString({ message: 'must be a string' })
  @MaxLength(20, { message: 'must be at most 20 characters' })
  size?: string;

  @IsOptional()
  @IsString({ message: 'must be a string' })
  @MaxLength(40, { message: 'must be at most 40 characters' })
  color?: string;

  /** An amount in minor units. 1999 means 19.99. */
  @IsOptional()
  @IsInt({ message: 'must be an integer' })
  @Min(0, { message: 'must be at least 0' })
  price?: number;
}
