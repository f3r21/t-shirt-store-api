import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { INT4_MAX } from '../../common/int4';
import { IsOptionalNotNull } from '../../common/is-optional-not-null';
import { OrderHistoryQueryDto } from './order-history-query.dto';

/**
 * Query parameters of `listAllOrders`: the history filters plus one client.
 * Manager-only at the guard.
 */
export class ListAllOrdersQueryDto extends OrderHistoryQueryDto {
  /** Return only the orders of this client. */
  @ApiPropertyOptional()
  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt({ message: 'must be an integer' })
  @Min(1, { message: 'must be at least 1' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  userId?: number;
}
