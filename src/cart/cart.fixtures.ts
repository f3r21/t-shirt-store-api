import type {
  CartItem as CartItemRow,
  Product as ProductRow,
  ProductImage as ProductImageRow,
  ProductVariant as ProductVariantRow,
} from '../generated/prisma/client';
import { aProduct, aVariant } from '../products/products.fixtures';
import type { CartLine } from './cart.mapper';

/**
 * One `cart_items` row: the fixture client holds two of the fixture variant.
 * Fixed values, so an assertion on a number is explicit.
 */
export function aCartRow(overrides: Partial<CartItemRow> = {}): CartItemRow {
  return {
    userId: 128,
    variantId: 21,
    quantity: 2,
    createdAt: new Date('2026-08-21T13:45:00.000Z'),
    ...overrides,
  };
}

/**
 * One line as `CART_LINE_INCLUDE` loads it: the row, its variant, the product,
 * and the primary image rows the include returned, none by default.
 *
 * The variant decides the ids: the row points at it and the product is the one
 * it belongs to, so an override of the variant's id or `productId` is enough
 * to keep the three consistent.
 */
export function aCartLine(
  overrides: {
    row?: Partial<CartItemRow>;
    variant?: Partial<ProductVariantRow>;
    product?: Partial<ProductRow>;
    images?: ProductImageRow[];
  } = {},
): CartLine {
  const variant = aVariant(overrides.variant);
  return {
    ...aCartRow({ variantId: variant.id, ...overrides.row }),
    variant: {
      ...variant,
      product: {
        ...aProduct({ id: variant.productId, ...overrides.product }),
        images: overrides.images ?? [],
      },
    },
  };
}
