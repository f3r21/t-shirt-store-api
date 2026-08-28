import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Request body of POST /products. See `openapi.yaml:571-593`.
 *
 * Each message omits the field name, because `Problem.errors[].field` carries
 * it.
 *
 * A `categoryIds` entry that names no category returns 422 and not 400. The
 * body is well formed and the server rejects it on its content, so that check
 * belongs to the service and not to this class.
 *
 * `@Type(() => Number)` on the array is required and not decoration.
 * `src/main.ts:19` sets `enableImplicitConversion: false`, so class-transformer
 * leaves each entry as it arrives and `@IsInt()` reads the real type.
 */
export class CreateProductDto {
  @IsString({ message: 'must be a string' })
  @MinLength(1, { message: 'must be at least 1 character' })
  @MaxLength(200, { message: 'must be at most 200 characters' })
  name!: string;

  @IsOptional()
  @IsString({ message: 'must be a string' })
  @MaxLength(5000, { message: 'must be at most 5000 characters' })
  description?: string;

  /** The categories of this product. */
  @IsOptional()
  @IsArray({ message: 'must be an array' })
  @ArrayUnique({ message: 'must not repeat a category' })
  @IsInt({ each: true, message: 'must be an integer' })
  @Min(1, { each: true, message: 'must be at least 1' })
  categoryIds?: number[];
}
