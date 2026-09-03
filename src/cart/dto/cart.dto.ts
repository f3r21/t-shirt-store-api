import { ApiProperty, ApiSchema } from '@nestjs/swagger';

/**
 * One line of the cart, the contract's `CartItem`. A live view: every field is
 * read from the variant now, and the order copies them when it is placed.
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
 * The contract's `Cart`. An empty cart is `{ items: [], subtotal: 0 }`, never
 * a 404.
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
