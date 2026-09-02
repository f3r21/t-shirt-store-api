import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { IsOptionalNotNull } from '../is-optional-not-null';
import { INT4_MAX } from '../int4';

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
 *
 * **`@ApiPropertyOptional` and not a `?` on the property, and the difference is
 * not cosmetic.** The plugin reads the TypeScript optional marker to decide
 * `required`, and without one it published both of these as required query
 * parameters against a contract that marks them optional. Measured across the
 * three collections, seven parameter entries said `required: true`. Writing
 * `limit?: number = 20` fixes the document and makes the type
 * `number | undefined`, which is false: the pipe transforms before any handler
 * runs, so the value is always present by the time a service reads it, and
 * three services would have to test for an `undefined` that cannot occur. The
 * request may omit it. The property never is.
 */
export class PageQueryDto {
  /** The default is 20 and the maximum is 100. */
  @ApiPropertyOptional()
  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt({ message: 'must be an integer' })
  @Min(1, { message: 'must be at least 1' })
  @Max(100, { message: 'must be at most 100' })
  limit: number = 20;

  /**
   * The number of rows to skip before the first row of this page.
   *
   * **The ceiling is not decoration.** `limit` has carried a `@Max` since it was
   * written and this did not, so an integer the contract admits reached Prisma's
   * `skip`, which refuses it with a validation error that nothing maps, and
   * `GET /products` answered 500 with no token. Same class as the `int4` bounds
   * on `categoryId` and on every price and stock field, and the same reasoning:
   * refusing at the edge turns a 500 into a 400.
   *
   * `INT4_MAX` rather than a number of its own, because an offset past the
   * largest id a table can hold is a page that cannot exist, and because the
   * constant already carries the measurement in `src/common/int4.ts`.
   */
  @ApiPropertyOptional()
  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt({ message: 'must be an integer' })
  @Min(0, { message: 'must be at least 0' })
  @Max(INT4_MAX, { message: `must be at most ${INT4_MAX}` })
  offset: number = 0;
}
