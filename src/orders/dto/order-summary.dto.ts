import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { OrderStatus } from '../../generated/prisma/enums';
import { OrderCustomerDto, ORDER_STATUSES } from './order.dto';

/**
 * One entry of an order list. See `openapi.yaml:2137-2166`.
 *
 * `itemCount` is the number of units across every line, so a list page does
 * not carry the lines themselves. `customer` is present only for a manager,
 * because feature 4 asks a manager to "show client orders" and a page of
 * orders with no client on them could not be acted on.
 */
@ApiSchema({ name: 'OrderSummary' })
export class OrderSummaryDto {
  id!: number;

  @ApiProperty({ enum: ORDER_STATUSES })
  status!: OrderStatus;

  /** The sum of the lines, before any discount, in minor units. */
  subtotal!: number;

  /** The amount the store charges, in minor units. */
  total!: number;

  /** Present only when the caller is a manager. */
  @ApiPropertyOptional({ type: () => OrderCustomerDto })
  customer?: OrderCustomerDto;

  /** The number of units in the order, across every line. */
  itemCount!: number;

  /** ISO 8601. */
  createdAt!: string;
}
