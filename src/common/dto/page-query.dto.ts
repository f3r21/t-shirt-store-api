import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { IsOptionalNotNull } from '../is-optional-not-null';
import { INT4_MAX } from '../int4';

/**
 * The `limit` and `offset` pair every collection takes, the contract's two
 * page parameters. `@Type(() => Number)` because the pipe does not convert
 * implicitly, and `@ApiPropertyOptional` instead of `?` because the value is
 * always present once the pipe has run.
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
   * Rows to skip. Bounded at `INT4_MAX`, because Prisma's `skip` refuses a
   * larger integer with an error nothing maps.
   */
  @ApiPropertyOptional()
  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt({ message: 'must be an integer' })
  @Min(0, { message: 'must be at least 0' })
  @Max(INT4_MAX, { message: `must be at most ${INT4_MAX}` })
  offset: number = 0;
}
