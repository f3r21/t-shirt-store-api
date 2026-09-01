import {
  ArrayUnique,
  IsArray,
  IsBoolean,
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
 * Request body of PATCH /products/{id}. See `openapi.yaml:667-690`.
 *
 * `categoryIds` replaces the whole set. The contract states this, so a caller
 * who sends one id leaves the product in one category.
 *
 * Set `isActive` to false to disable the product. Disabling is not deleting. A
 * disabled product stays visible to a manager and disappears for every other
 * caller.
 *
 * The contract also declares `minProperties: 1`, and this class still does not
 * enforce it, because class-validator cannot. Version 0.15.1 types
 * `registerDecorator`'s `propertyName` as a required string, so there is no
 * class level constraint, and hanging the rule on a property fails too: every
 * field here is optional, and an optional property short circuits its remaining
 * validators the moment the value is absent, which is the case being caught.
 * `NonEmptyBodyPipe` enforces it instead, at
 * `src/common/non-empty-body.pipe.ts`, and `products.controller.ts` applies it
 * to this operation.
 *
 * Every optional property carries `@IsOptionalNotNull` and not `@IsOptional`.
 * This body is where the difference was measured: `{"categoryIds": null}`
 * answered 500 and `{"description": null}` answered 200 and erased the column.
 */
export class UpdateProductDto {
  @IsOptionalNotNull()
  @IsString({ message: 'must be a string' })
  @MinLength(1, { message: 'must be at least 1 character' })
  @MaxLength(200, { message: 'must be at most 200 characters' })
  name?: string;

  @IsOptionalNotNull()
  @IsString({ message: 'must be a string' })
  @MaxLength(5000, { message: 'must be at most 5000 characters' })
  description?: string;

  @IsOptionalNotNull()
  @IsBoolean({ message: 'must be a boolean' })
  isActive?: boolean;

  /** The server replaces the whole set of categories. */
  @IsOptionalNotNull()
  @IsArray({ message: 'must be an array' })
  @ArrayUnique({ message: 'must not repeat a category' })
  @IsInt({ each: true, message: 'must be an integer' })
  @Min(1, { each: true, message: 'must be at least 1' })
  @Max(INT4_MAX, { each: true, message: 'must be at most 2147483647' })
  categoryIds?: number[];
}
