import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { INT4_MAX } from '../../common/int4';
import { IsOptionalNotNull } from '../../common/is-optional-not-null';

/**
 * Query parameters of `listProducts`. `categoryId` is bounded because the
 * route is reachable with no token. `includeInactive` must not use
 * `@Type(() => Boolean)`, because `Boolean('false')` is true: the transform
 * maps the two spellings and leaves anything else for `@IsBoolean` to refuse.
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
