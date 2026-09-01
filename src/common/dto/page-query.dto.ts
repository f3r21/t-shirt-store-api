import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { IsOptionalNotNull } from '../is-optional-not-null';

/**
 * Query parameters of every collection. The contract declares the pair at
 * `openapi.yaml:2189-2210`, and every collection references both.
 *
 * `@Type(() => Number)` is required and not decoration.
 * `src/common/validation-pipe-options.ts:20` sets
 * `enableImplicitConversion: false`, so a query value arrives as a string. A
 * bare `@IsInt()` would reject `?limit=20` and every paginated request would
 * answer 400.
 *
 * `offset` carries no upper bound and does not need one. It becomes Prisma's
 * `skip`, which is SQL `OFFSET`, which Postgres takes as `bigint`. Measured:
 * `skip=999999999999` returns an empty page rather than an error, so there is no
 * `int4` ceiling here to defend, unlike the id and stock columns in
 * `src/common/int4.ts`.
 */
export class PageQueryDto {
  /** The default is 20 and the maximum is 100. */
  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt({ message: 'must be an integer' })
  @Min(1, { message: 'must be at least 1' })
  @Max(100, { message: 'must be at most 100' })
  limit: number = 20;

  /** The number of rows to skip before the first row of this page. */
  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt({ message: 'must be an integer' })
  @Min(0, { message: 'must be at least 0' })
  offset: number = 0;
}
