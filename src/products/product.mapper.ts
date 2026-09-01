import { Prisma } from '../generated/prisma/client';
import type {
  Product as ProductRow,
  ProductVariant as ProductVariantRow,
  ProductImage as ProductImageRow,
  Category as CategoryRow,
} from '../generated/prisma/client';
import { ProductDto, ProductImageDto } from './dto/product.dto';
import { ProductSummaryDto } from './dto/product-summary.dto';
import { toProductVariantDto } from '../variants/variant.mapper';
import { toCategoryDto } from '../categories/category.mapper';

/** A product row with everything the detail response names. */
export type ProductWithRelations = ProductRow & {
  variants: ProductVariantRow[];
  images: ProductImageRow[];
  categories: { category: CategoryRow }[];
};

/**
 * Map a product row to one entry of the list.
 *
 * `priceFrom` is the cheapest variant, and it is **absent** when the product has
 * none. Absent and not zero: zero would read as free. The caller supplies it,
 * because computing it per row would be one query per product.
 * `primaryImageUrl` follows the same rule for the same reason: absent when the
 * product has no primary image, and supplied by the caller from one query per
 * page.
 *
 * The function names every field it copies and never spreads the row, so
 * `deletedAt` has no path to a response.
 */
export function toProductSummaryDto(
  row: ProductRow,
  priceFrom?: number,
  primaryImageUrl?: string,
): ProductSummaryDto {
  const dto: ProductSummaryDto = {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };

  if (priceFrom !== undefined) {
    dto.priceFrom = priceFrom;
  }
  if (primaryImageUrl !== undefined) {
    dto.primaryImageUrl = primaryImageUrl;
  }

  return dto;
}

/**
 * Map one image row to the contract's `ProductImage`. Three fields, named,
 * so `productId` and anything the table grows later has no path to a response.
 */
export function toProductImageDto(row: ProductImageRow): ProductImageDto {
  return { id: row.id, url: row.url, isPrimary: row.isPrimary };
}

/**
 * Map a product row and its relations to the detail response.
 *
 * `images` comes from `product_images`, which migration `20260829023040`
 * created, primary first and then by id. **This used to be a hard-coded empty
 * array under a comment saying no image table existed.** The table did; nothing
 * writes it until `uploadProductImage` lands, so every product created through
 * the API still answers `[]`. The read is wired now so that operation lands
 * into a working detail rather than a mapper that ignores its rows.
 */
export function toProductDto(row: ProductWithRelations): ProductDto {
  const dto: ProductDto = {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    variants: row.variants.map(toProductVariantDto),
    images: row.images.map(toProductImageDto),
    categories: row.categories.map((link) => toCategoryDto(link.category)),
  };

  if (row.description !== null) {
    dto.description = row.description;
  }

  return dto;
}

/** What a detail read has to load for `toProductDto` to be satisfiable. */
export const PRODUCT_DETAIL_INCLUDE = {
  variants: { orderBy: { id: 'asc' } },
  // Primary first, then by id, so a client that shows one image shows the
  // right one without sorting, and the order is stable across reads.
  images: { orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }] },
  categories: { include: { category: true } },
  // `satisfies` and not `as const`. `as const` freezes the nested arrays, and
  // Prisma's input types are mutable, so the readonly version is rejected at
  // every call site rather than here.
} satisfies Prisma.ProductInclude;
