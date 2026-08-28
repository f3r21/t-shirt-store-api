import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Query parameters of every collection. The contract declares the pair at
 * `openapi.yaml:2189-2210`, and every collection references both.
 *
 * `@Type(() => Number)` is required and not decoration. `src/main.ts` sets
 * `enableImplicitConversion: false`, so a query value arrives as a string. A
 * bare `@IsInt()` would reject `?limit=20` and every paginated request would
 * answer 400.
 */
export class PageQueryDto {
  /** The default is 20 and the maximum is 100. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'must be an integer' })
  @Min(1, { message: 'must be at least 1' })
  @Max(100, { message: 'must be at most 100' })
  limit: number = 20;

  /** The number of rows to skip before the first row of this page. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'must be an integer' })
  @Min(0, { message: 'must be at least 0' })
  offset: number = 0;
}
