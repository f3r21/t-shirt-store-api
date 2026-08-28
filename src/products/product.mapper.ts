import { Prisma } from '../generated/prisma/client';
import type {
  Product as ProductRow,
  ProductVariant as ProductVariantRow,
  Category as CategoryRow,
} from '../generated/prisma/client';
import { ProductDto } from './dto/product.dto';
import { ProductSummaryDto } from './dto/product-summary.dto';
import { toProductVariantDto } from '../variants/variant.mapper';
import { toCategoryDto } from '../categories/category.mapper';

/** A product row with everything the detail response names. */
export type ProductWithRelations = ProductRow & {
  variants: ProductVariantRow[];
  categories: { category: CategoryRow }[];
};

/**
 * Map a product row to one entry of the list.
 *
 * `priceFrom` is the cheapest variant, and it is **absent** when the product has
 * none. Absent and not zero: zero would read as free. The caller supplies it,
 * because computing it per row would be one query per product.
 *
 * The function names every field it copies and never spreads the row, so
 * `deletedAt` has no path to a response.
 */
export function toProductSummaryDto(
  row: ProductRow,
  priceFrom?: number,
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

  return dto;
}

/**
 * Map a product row and its relations to the detail response.
 *
 * `images` is always an empty array. The contract makes the member required and
 * no image table exists yet, so an empty array is the honest answer and the
 * shape a client can already code against.
 */
export function toProductDto(row: ProductWithRelations): ProductDto {
  const dto: ProductDto = {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    variants: row.variants.map(toProductVariantDto),
    images: [],
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
  categories: { include: { category: true } },
  // `satisfies` and not `as const`. `as const` freezes the nested arrays, and
  // Prisma's input types are mutable, so the readonly version is rejected at
  // every call site rather than here.
} satisfies Prisma.ProductInclude;
