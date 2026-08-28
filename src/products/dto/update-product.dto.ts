import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Request body of PATCH /products/{id}. See `openapi.yaml:667-690`.
 *
 * `categoryIds` replaces the whole set. The contract states this, so a caller
 * who sends one id leaves the product in one category.
 *
 * Set `isActive` to false to disable the product. Disabling is not deleting. A
 * disabled product stays visible to a manager and disappears for every other
 * caller.
 *
 * The contract also declares `minProperties: 1`, and this class does not
 * enforce it. class-validator carries no built-in rule for "at least one
 * property is present", and a class-level custom validator is a decorator. An
 * empty body therefore reaches the service today and updates nothing.
 */
export class UpdateProductDto {
  @IsOptional()
  @IsString({ message: 'must be a string' })
  @MinLength(1, { message: 'must be at least 1 character' })
  @MaxLength(200, { message: 'must be at most 200 characters' })
  name?: string;

  @IsOptional()
  @IsString({ message: 'must be a string' })
  @MaxLength(5000, { message: 'must be at most 5000 characters' })
  description?: string;

  @IsOptional()
  @IsBoolean({ message: 'must be a boolean' })
  isActive?: boolean;

  /** The server replaces the whole set of categories. */
  @IsOptional()
  @IsArray({ message: 'must be an array' })
  @ArrayUnique({ message: 'must not repeat a category' })
  @IsInt({ each: true, message: 'must be an integer' })
  @Min(1, { each: true, message: 'must be at least 1' })
  categoryIds?: number[];
}
