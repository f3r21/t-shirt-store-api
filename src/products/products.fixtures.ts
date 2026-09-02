import type {
  Category as CategoryRow,
  Product as ProductRow,
  ProductImage as ProductImageRow,
  ProductVariant as ProductVariantRow,
} from '../generated/prisma/client';
import type { ProductWithRelations } from './product.mapper';

/**
 * Fixed rows, so two calls in one test return the same values and an assertion
 * on an id is explicit. Pass `overrides` for the field under test.
 */
export function aProduct(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 7,
    name: 'Nerdery classic tee',
    description: 'Heavyweight cotton.',
    isActive: true,
    createdAt: new Date('2026-08-21T13:45:00.000Z'),
    updatedAt: new Date('2026-08-21T13:45:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

export function aVariant(
  overrides: Partial<ProductVariantRow> = {},
): ProductVariantRow {
  return {
    id: 21,
    productId: 7,
    size: 'M',
    color: 'black',
    priceCents: 1999,
    stock: 7,
    createdAt: new Date('2026-08-21T13:45:00.000Z'),
    updatedAt: new Date('2026-08-21T13:45:00.000Z'),
    ...overrides,
  };
}

export function aCategory(overrides: Partial<CategoryRow> = {}): CategoryRow {
  return { id: 3, name: 'T-shirts', ...overrides };
}

export function anImage(
  overrides: Partial<ProductImageRow> = {},
): ProductImageRow {
  return {
    id: 88,
    productId: 7,
    url: 'https://cdn.tshirt.store/products/7/front.jpg',
    isPrimary: true,
    ...overrides,
  };
}

/**
 * No image by default, which is the state every product created through the
 * API is in until the upload operation exists. A test about images says so.
 */
export function aProductWithRelations(
  overrides: Partial<ProductWithRelations> = {},
): ProductWithRelations {
  return {
    ...aProduct(),
    variants: [aVariant()],
    images: [],
    categories: [{ category: aCategory() }],
    ...overrides,
  };
}

/** A manager and a client, as the guards and services see them. */
export const AS_MANAGER = { sub: 1, sid: 1, role: 'manager' };
export const AS_CLIENT = { sub: 128, sid: 42, role: 'client' };
