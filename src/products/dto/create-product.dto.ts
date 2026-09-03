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
import { ApiPropertyOptional } from '@nestjs/swagger';
import { INT4_MAX } from '../../common/int4';
import { IsOptionalNotNull } from '../../common/is-optional-not-null';

/**
 * Request body of `createProduct`. Messages omit the field name, because
 * `Problem.errors[].field` carries it. An unknown category is 422 from the
 * service; an id above `INT4_MAX` is 400 here, because no category could
 * carry it.
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
  // `type: [Number]` is not decoration. The plugin cannot read the element
  // type of `number[]` here and served `items: { type: 'string' }`, so a
  // generated client would have sent an array of strings to a column of
  // integers.
  @ApiPropertyOptional({ type: [Number] })
  @IsOptionalNotNull()
  @IsArray({ message: 'must be an array' })
  @ArrayUnique({ message: 'must not repeat a category' })
  @IsInt({ each: true, message: 'must be an integer' })
  @Min(1, { each: true, message: 'must be at least 1' })
  @Max(INT4_MAX, { each: true, message: 'must be at most 2147483647' })
  categoryIds?: number[];
}
