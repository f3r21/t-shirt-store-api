import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { INT4_MAX } from '../../common/int4';
import { IsOptionalNotNull } from '../../common/is-optional-not-null';

/**
 * Request body of POST /products. See `openapi.yaml:571-593`.
 *
 * Each message omits the field name, because `Problem.errors[].field` carries
 * it.
 *
 * A `categoryIds` entry that names no category returns 422 and not 400. The
 * body is well formed and the server rejects it on its content, so that check
 * belongs to the service and not to this class. An entry above `INT4_MAX` is a
 * different case and belongs here: no category could carry that id, so the
 * service never gets to ask, and Postgres answers `P2020` and a 500 instead.
 *
 * `@Type(() => Number)` on the array is required and not decoration.
 * `src/common/validation-pipe-options.ts:20` sets `enableImplicitConversion: false`, so class-transformer
 * leaves each entry as it arrives and `@IsInt()` reads the real type.
 */
export class CreateProductDto {
  @IsString({ message: 'must be a string' })
  @MinLength(1, { message: 'must be at least 1 character' })
  @MaxLength(200, { message: 'must be at most 200 characters' })
  name!: string;

  @IsOptionalNotNull()
  @IsString({ message: 'must be a string' })
  @MaxLength(5000, { message: 'must be at most 5000 characters' })
  description?: string;

  /** The categories of this product. */
  @IsOptionalNotNull()
  @IsArray({ message: 'must be an array' })
  @ArrayUnique({ message: 'must not repeat a category' })
  @IsInt({ each: true, message: 'must be an integer' })
  @Min(1, { each: true, message: 'must be at least 1' })
  @Max(INT4_MAX, { each: true, message: 'must be at most 2147483647' })
  categoryIds?: number[];
}
