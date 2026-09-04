import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { OrderStatus, PaymentMethod } from '../../generated/prisma/enums';

/** The six values, for the document. The generated enum is the source. */
export const ORDER_STATUSES = Object.values(OrderStatus);

/** The two Stripe flows, for the document. */
export const PAYMENT_METHODS = Object.values(PaymentMethod);

/**
 * The contract's `OrderItem`: a snapshot of the name and the price at the
 * time of the order, so no `stock` and no `imageUrl`.
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

/** The contract's `OrderStatusChange`: one status the order has held. */
@ApiSchema({ name: 'OrderStatusChange' })
export class OrderStatusChangeDto {
  @ApiProperty({ enum: ORDER_STATUSES })
  status!: OrderStatus;

  /** ISO 8601. */
  changedAt!: string;
}

/** The contract's `OrderCustomer`, present for a manager only. */
@ApiSchema({ name: 'OrderCustomer' })
export class OrderCustomerDto {
  id!: number;

  email!: string;

  firstName!: string;

  lastName!: string;
}

/**
 * The contract's `Order`. `subtotal` less `discount` is `total`, and the two
 * amounts are equal on an order that used no code. `paymentMethod` is absent
 * until the webhook writes it.
 */
@ApiSchema({ name: 'Order' })
export class OrderDto {
  id!: number;

  @ApiProperty({ enum: ORDER_STATUSES })
  status!: OrderStatus;

  /** The sum of the lines, before any discount, in minor units. */
  subtotal!: number;

  /** What the promo code took off the subtotal. 0 when there was no code. */
  discount!: number;

  /** The amount the store charges, in minor units. The subtotal less the discount. */
  total!: number;

  /**
   * The promo code this order used, in the case the manager typed. Absent when
   * the order used no code. A copy taken at checkout, so a later change to the
   * code does not reach this order.
   */
  promoCode?: string;

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
