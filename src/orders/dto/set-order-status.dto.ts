import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { REQUESTABLE_STATUSES } from '../order-status';
import type { RequestableStatus } from '../order-status';

/**
 * Request body of `setOrderStatus`. Narrower than `OrderStatus`: `pending` is
 * the start and the webhook sets `paid`. The four here are what some caller
 * may send; the ability decides which caller, and answers 403 otherwise.
 */
export class SetOrderStatusDto {
  @ApiProperty({ enum: REQUESTABLE_STATUSES })
  @IsIn(REQUESTABLE_STATUSES, {
    message: 'must be one of processing, shipped, delivered, cancelled',
  })
  status!: RequestableStatus;
}
