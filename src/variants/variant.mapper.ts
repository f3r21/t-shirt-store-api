import type { ProductVariant as ProductVariantRow } from '../generated/prisma/client';
import type { ProductVariantDto } from './dto/product-variant.dto';

/**
 * A `product_variants` row to the response. The empty string is how an absent
 * option is stored, so the unique index can see a duplicate pair, and this is
 * where the two spellings meet. ADR 13, ADR 14.
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
