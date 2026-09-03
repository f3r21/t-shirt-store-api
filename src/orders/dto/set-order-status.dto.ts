import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { REQUESTABLE_STATUSES } from '../order-status';
import type { RequestableStatus } from '../order-status';

/**
 * Request body of `setOrderStatus`. Narrower than `OrderStatus`: `pending` is
 * the start, the webhook sets `paid`, and `delivered` is out of scope.
 */
export class SetOrderStatusDto {
  @ApiProperty({ enum: REQUESTABLE_STATUSES })
  @IsIn(REQUESTABLE_STATUSES, {
    message: 'must be one of processing, shipped, cancelled',
  })
  status!: RequestableStatus;
}
