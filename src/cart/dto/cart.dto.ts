import { ApiProperty, ApiSchema } from '@nestjs/swagger';

/**
 * One line of the cart. See `openapi.yaml:2064-2095`.
 *
 * A cart is a live view and not a record. Every field here is read from the
 * variant and its product at the moment of the request: a manager who renames a
 * product or changes a price changes what a cart that holds it says. The order
 * copies these values when it is placed, and that copy is `OrderItem`.
 *
 * `size`, `color` and `imageUrl` are absent rather than null, the rule
 * `ProductVariantDto` and `ProductSummaryDto` already follow.
 */
@ApiSchema({ name: 'CartItem' })
export class CartItemDto {
  variantId!: number;

  productId!: number;

  /** The name of the product now. */
  productName!: string;

  /** Absent when the variant carries no size. */
  size?: string;

  /** Absent when the variant carries no color. */
  color?: string;

  /** The primary image of the product. Absent when the product has none. */
  imageUrl?: string;

  /** The price of the variant now, in minor units. 1999 means 19.99. */
  unitPrice!: number;

  quantity!: number;

  /** The unit price multiplied by the quantity, in minor units. */
  lineTotal!: number;

  /**
   * The units on hand for this variant now. It can fall below `quantity`
   * after the user added the line, and the checkout then fails.
   */
  stock!: number;
}

/**
 * Response shape of every cart operation that answers a body. See
 * `openapi.yaml:2050-2062`.
 *
 * A user who never added anything receives `{ items: [], subtotal: 0 }` and
 * not a 404. The cart exists because the user exists.
 */
@ApiSchema({ name: 'Cart' })
export class CartDto {
  /**
   * The explicit lazy `type` is the same workaround `ProductDto` records: the
   * Swagger plugin's own inference explores this class before `CartItemDto` is
   * registered and reports a circular dependency that does not exist.
   */
  @ApiProperty({ type: () => CartItemDto, isArray: true })
  items!: CartItemDto[];

  /**
   * The sum of the line totals, in minor units. It carries no tax and no
   * delivery charge, because this store applies neither.
   */
  subtotal!: number;
}
