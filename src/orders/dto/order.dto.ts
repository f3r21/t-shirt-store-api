import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { OrderStatus, PaymentMethod } from '../../generated/prisma/enums';

/** The six values, for the document. The generated enum is the source. */
export const ORDER_STATUSES = Object.values(OrderStatus);

/** The two Stripe flows, for the document. */
export const PAYMENT_METHODS = Object.values(PaymentMethod);

/**
 * One line of an order. See `openapi.yaml:2207-2240`.
 *
 * A snapshot, unlike `CartItem`: the name and the price are the ones the
 * client saw when the order was placed, copied into `order_items`, and a later
 * rename or reprice does not reach them. That is why there is no `stock` and
 * no `imageUrl` here: both describe the catalog now, and an order is a record.
 */
@ApiSchema({ name: 'OrderItem' })
export class OrderItemDto {
  variantId!: number;

  productId!: number;

  /** The name of the product when the client placed the order. */
  productName!: string;

  /** Absent when the variant carried no size. */
  size?: string;

  /** Absent when the variant carried no color. */
  color?: string;

  /** The price of the variant when the order was placed, in minor units. */
  unitPrice!: number;

  quantity!: number;

  /** The unit price multiplied by the quantity, in minor units. */
  lineTotal!: number;
}

/** One status the order has held, and when it began. See `openapi.yaml:2241-2250`. */
@ApiSchema({ name: 'OrderStatusChange' })
export class OrderStatusChangeDto {
  @ApiProperty({ enum: ORDER_STATUSES })
  status!: OrderStatus;

  /** ISO 8601. */
  changedAt!: string;
}

/**
 * The client who placed the order. See `openapi.yaml:2111-2130`.
 *
 * Present when the caller is a manager. A client reading its own history
 * already knows whose the order is, so the member is absent there.
 */
@ApiSchema({ name: 'OrderCustomer' })
export class OrderCustomerDto {
  id!: number;

  email!: string;

  firstName!: string;

  lastName!: string;
}

/**
 * Response shape of `POST /orders`, `GET /orders/{id}` and
 * `PATCH /orders/{id}/status`. See `openapi.yaml:2167-2206`.
 *
 * `subtotal` and `total` are equal until a promo code exists, and both ship
 * because the contract does. `paymentMethod` is absent until a payment
 * succeeds, and the webhook is its only writer.
 */
@ApiSchema({ name: 'Order' })
export class OrderDto {
  id!: number;

  @ApiProperty({ enum: ORDER_STATUSES })
  status!: OrderStatus;

  /** The sum of the lines, before any discount, in minor units. */
  subtotal!: number;

  /** The amount the store charges, in minor units. */
  total!: number;

  /** The explicit lazy `type` is the workaround `ProductDto` records. */
  @ApiProperty({ type: () => OrderItemDto, isArray: true })
  items!: OrderItemDto[];

  /** Present only when the caller is a manager. */
  @ApiPropertyOptional({ type: () => OrderCustomerDto })
  customer?: OrderCustomerDto;

  /** The Stripe flow that paid this order. Absent until a payment succeeds. */
  @ApiPropertyOptional({ enum: PAYMENT_METHODS })
  paymentMethod?: PaymentMethod;

  /** ISO 8601. */
  createdAt!: string;

  /** Every status this order has held, oldest first. */
  @ApiProperty({ type: () => OrderStatusChangeDto, isArray: true })
  statusHistory!: OrderStatusChangeDto[];
}
