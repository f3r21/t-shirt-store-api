import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { REQUESTABLE_STATUSES } from '../order-status';
import type { RequestableStatus } from '../order-status';

/**
 * Request body of PATCH /orders/{id}/status. See `openapi.yaml:1552-1566`.
 *
 * The set is narrower than `OrderStatus` on purpose: `pending` is the start,
 * the webhook sets `paid`, and `delivered` is out of scope. A value outside
 * the three is a 400 here, before the status table ever sees it; the table
 * decides what the three mean for this caller and this order.
 */
export class SetOrderStatusDto {
  @ApiProperty({ enum: REQUESTABLE_STATUSES })
  @IsIn(REQUESTABLE_STATUSES, {
    message: 'must be one of processing, shipped, cancelled',
  })
  status!: RequestableStatus;
}
