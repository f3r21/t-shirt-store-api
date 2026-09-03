import type { Prisma } from '../generated/prisma/client';
import type {
  CartItem as CartItemRow,
  Product as ProductRow,
  ProductImage as ProductImageRow,
  ProductVariant as ProductVariantRow,
} from '../generated/prisma/client';
import type { CartDto, CartItemDto } from './dto/cart.dto';

/** A cart row with its variant, that variant's product, and the primary image. */
export type CartLine = CartItemRow & {
  variant: ProductVariantRow & {
    product: ProductRow & { images: ProductImageRow[] };
  };
};

/**
 * What a cart read loads for `toCartItemDto` to be satisfiable.
 *
 * The image include is the products list's primary-image rule, written inline:
 * rows marked primary, lowest id first, one of them, so two rows of one product
 * that both claim primary resolve the same way on the list and in the cart.
 * `products.service.ts` answers that rule in a separate query because a page of
 * products needs one query for the whole page; a cart is one user's rows, so
 * the include is that query.
 */
export const CART_LINE_INCLUDE = {
  variant: {
    include: {
      product: {
        include: {
          images: {
            where: { isPrimary: true },
            orderBy: { id: 'asc' },
            take: 1,
          },
        },
      },
    },
  },
  // `satisfies` and not `as const`, for the reason `PRODUCT_DETAIL_INCLUDE`
  // records: Prisma's input types are mutable.
} satisfies Prisma.CartItemInclude;

/**
 * Map one cart row and its relations to the contract's `CartItem`.
 *
 * The function names every field it copies and never spreads a row, so
 * `userId`, `createdAt` and the product's `deletedAt` have no path to a
 * response. The empty string is how "no size" is stored, and absence is how it
 * travels; `variant.mapper.ts` records why the column is not null.
 */
export function toCartItemDto(row: CartLine): CartItemDto {
  const { variant } = row;
  const dto: CartItemDto = {
    variantId: row.variantId,
    productId: variant.productId,
    productName: variant.product.name,
    unitPrice: variant.priceCents,
    quantity: row.quantity,
    lineTotal: variant.priceCents * row.quantity,
    stock: variant.stock,
  };

  if (variant.size !== '') {
    dto.size = variant.size;
  }
  if (variant.color !== '') {
    dto.color = variant.color;
  }
  const image = variant.product.images[0];
  if (image !== undefined) {
    dto.imageUrl = image.url;
  }

  return dto;
}

/** Map the rows of one user to the contract's `Cart`. No rows is an empty cart. */
export function toCartDto(rows: CartLine[]): CartDto {
  const items = rows.map(toCartItemDto);
  return {
    items,
    subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0),
  };
}
