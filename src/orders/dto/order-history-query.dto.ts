import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsISO8601, Max, Min } from 'class-validator';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { INT4_MAX } from '../../common/int4';
import { IsOptionalNotNull } from '../../common/is-optional-not-null';
import { OrderStatus } from '../../generated/prisma/enums';
import { ORDER_STATUSES } from './order.dto';

/**
 * Query parameters of `listMyOrders`: the page pair plus five filters.
 * `createdFrom` is inclusive and `createdTo` exclusive, the contract's words,
 * and both arrive as strings. `@Type(() => Number)` because the pipe converts
 * nothing implicitly.
 */
export class OrderHistoryQueryDto extends PageQueryDto {
  /** Return only the orders in this status. */
  @ApiPropertyOptional({ enum: ORDER_STATUSES })
  @IsOptionalNotNull()
  @IsIn(ORDER_STATUSES, {
    message:
      'must be one of pending, paid, processing, shipped, delivered, cancelled',
  })
  status?: OrderStatus;

  /** Return the orders created at this time or after it. Inclusive. */
  @ApiPropertyOptional()
  @IsOptionalNotNull()
  @IsISO8601({ strict: true }, { message: 'must be an ISO 8601 date-time' })
  createdFrom?: string;

  /** Return the orders created before this time. Exclusive. */
  @ApiPropertyOptional()
  @IsOptionalNotNull()
  @IsISO8601({ strict: true }, { message: 'must be an ISO 8601 date-time' })
  createdTo?: string;

  /** Return the orders whose total is this value or more, in minor units. */
  @ApiPropertyOptional()
  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt({ message: 'must be an integer' })
  @Min(0, { message: 'must be at least 0' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  minTotal?: number;

  /** Return the orders whose total is this value or less, in minor units. */
  @ApiPropertyOptional()
  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt({ message: 'must be an integer' })
  @Min(0, { message: 'must be at least 0' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  maxTotal?: number;
}
