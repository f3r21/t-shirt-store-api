import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Request body of POST /products/{id}/variants. See `openapi.yaml:950-973`.
 *
 * Each message omits the field name, because `Problem.errors[].field` carries
 * it.
 *
 * The contract sets no upper bound on `price` or on `stock`, and sets no
 * minimum length on `size` or on `color`, so an empty string passes both.
 */
export class CreateVariantDto {
  @IsOptional()
  @IsString({ message: 'must be a string' })
  @MaxLength(20, { message: 'must be at most 20 characters' })
  size?: string;

  @IsOptional()
  @IsString({ message: 'must be a string' })
  @MaxLength(40, { message: 'must be at most 40 characters' })
  color?: string;

  /** An amount in minor units. 1999 means 19.99. */
  @IsInt({ message: 'must be an integer' })
  @Min(0, { message: 'must be at least 0' })
  price!: number;

  @IsInt({ message: 'must be an integer' })
  @Min(0, { message: 'must be at least 0' })
  stock!: number;
}
