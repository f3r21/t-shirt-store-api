import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { IsOptionalNotNull } from '../../common/is-optional-not-null';

/**
 * The two statuses a delivery person works in: the queue and the history.
 * Two of the six and not the whole enum, because the other four name no work
 * this role can do.
 */
export const DELIVERY_STATUSES = ['shipped', 'delivered'] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * Query parameters of `listDeliveries`: the page pair plus the one status.
 * `shipped` is the default, because the queue is the screen that opens on a
 * shift. The value is always present once the pipe has run, so it is declared
 * with `@ApiPropertyOptional` and not with `?`, the way `PageQueryDto` does.
 */
export class ListDeliveriesQueryDto extends PageQueryDto {
  /** The orders waiting for delivery, or the ones already delivered. */
  @ApiPropertyOptional({ enum: DELIVERY_STATUSES })
  @IsOptionalNotNull()
  @IsIn(DELIVERY_STATUSES, {
    message: 'must be one of shipped, delivered',
  })
  status: DeliveryStatus = 'shipped';
}
