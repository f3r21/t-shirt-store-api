import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { INT4_MAX } from '../../common/int4';
import { IsOptionalNotNull } from '../../common/is-optional-not-null';

/**
 * Query parameters of GET /products. See `openapi.yaml:514-532`.
 *
 * The class extends `PageQueryDto`, so `limit` and `offset` keep the defaults
 * every collection declares and this file states only what is new.
 *
 * `categoryId` carries an upper bound because this operation is `@OptionalAuth`
 * and so reachable with no token. Measured before the bound existed,
 * `?categoryId=2147483648` reached Prisma, which answered `P2020`, which nothing
 * maps, which left a 500 one anonymous request could produce.
 *
 * `includeInactive` must not use `@Type(() => Boolean)`.
 * `node_modules/class-transformer/cjs/TransformOperationExecutor.js:91-94`
 * returns `Boolean(value)` for that target type, and `Boolean('false')` is
 * `true`. A caller who sends `?includeInactive=false` would then ask for the
 * disabled products and receive 403.
 *
 * The transform maps the two spellings the contract allows and returns every
 * other value unchanged, so `@IsBoolean()` rejects it and the operation keeps
 * the 400 it declares.
 */
export class ListProductsQueryDto extends PageQueryDto {
  /** Return only the products in this category. */
  @ApiPropertyOptional()
  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt({ message: 'must be an integer' })
  @Min(1, { message: 'must be at least 1' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  categoryId?: number;

  /**
   * Include the disabled products.
   *
   * Only a manager may set this field to true. A caller with no token receives
   * 401 and a caller who is not a manager receives 403. The guard applies both
   * rules, because this class cannot read the caller.
   */
  @ApiPropertyOptional()
  @IsOptionalNotNull()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean({ message: 'must be a boolean' })
  includeInactive: boolean = false;
}
