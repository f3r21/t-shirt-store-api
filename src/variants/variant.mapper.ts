import type { ProductVariant as ProductVariantRow } from '../generated/prisma/client';
import { ProductVariantDto } from './dto/product-variant.dto';

/**
 * Map a `product_variants` row to the response shape.
 *
 * The empty string is how "this variant has no size" is stored, and absence is
 * how it travels. The column is not null so that the unique index can enforce
 * the one-pair-per-product rule, which a nullable column cannot: PostgreSQL
 * treats two NULLs in a unique index as distinct. This function is where the two
 * spellings meet, so nothing else has to know about the empty string.
 *
 * `price` is the integer minor unit the contract declares. The column is named
 * `price_cents` so the database says the same thing the wire does.
 */
export function toProductVariantDto(row: ProductVariantRow): ProductVariantDto {
  const dto: ProductVariantDto = {
    id: row.id,
    price: row.priceCents,
    stock: row.stock,
  };

  if (row.size !== '') {
    dto.size = row.size;
  }
  if (row.color !== '') {
    dto.color = row.color;
  }

  return dto;
}

/** The wire spelling of an absent option, turned into the stored one. */
export function toStoredOption(value: string | undefined): string {
  return value ?? '';
}
