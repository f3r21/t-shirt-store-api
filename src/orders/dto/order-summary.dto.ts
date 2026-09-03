import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { OrderStatus } from '../../generated/prisma/enums';
import { OrderCustomerDto, ORDER_STATUSES } from './order.dto';

/**
 * The contract's `OrderSummary`. `itemCount` counts units, so a page carries
 * no lines, and `customer` is present for a manager only.
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
