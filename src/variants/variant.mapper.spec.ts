import type { ProductVariant as ProductVariantRow } from '../generated/prisma/client';
import { toProductVariantDto, toStoredOption } from './variant.mapper';

/**
 * The two spellings of an absent option, and the seam where they meet.
 *
 * `size` and `color` are NOT NULL columns whose empty string means "this
 * variant has no size", and the reason is the unique index: PostgreSQL treats
 * two NULLs as distinct, so a nullable column cannot enforce one pair per
 * product. That decision is defended in `schema.prisma:94-100` and it costs
 * exactly one thing, the translation in this file.
 *
 * Nothing tested it. Rewrite either guard to always fire and the stored empty
 * string reaches the wire as `size: ""`, which contradicts the contract's
 * absent-means-none reading, and the whole suite stays green.
 */
describe('variant.mapper', () => {
  const row = (over: Partial<ProductVariantRow> = {}): ProductVariantRow =>
    ({
      id: 3,
      productId: 7,
      size: 'M',
      color: 'black',
      priceCents: 1999,
      stock: 4,
      ...over,
    }) as ProductVariantRow;

  describe('toProductVariantDto', () => {
    it('carries size and color when the row holds them', () => {
      const dto = toProductVariantDto(row());

      expect(dto).toEqual({
        id: 3,
        size: 'M',
        color: 'black',
        price: 1999,
        stock: 4,
      });
    });

    /**
     * Absent, not empty. `toEqual` is the assertion that matters here, because
     * `toMatchObject` would pass on a DTO carrying `size: ''` and this is the
     * one branch where an empty string on the wire is the bug.
     */
    it('omits an option stored as the empty string', () => {
      const dto = toProductVariantDto(row({ size: '', color: '' }));

      expect(dto).toEqual({ id: 3, price: 1999, stock: 4 });
      expect('size' in dto).toBe(false);
      expect('color' in dto).toBe(false);
    });

    it('omits one option while keeping the other', () => {
      const dto = toProductVariantDto(row({ size: '' }));

      expect(dto).toEqual({ id: 3, color: 'black', price: 1999, stock: 4 });
    });

    it('sends the price from price_cents and never the column name', () => {
      const dto = toProductVariantDto(row({ priceCents: 2500 }));

      expect(dto.price).toBe(2500);
      expect(dto).not.toHaveProperty('priceCents');
    });
  });

  describe('toStoredOption', () => {
    it('turns an absent option into the empty string the column requires', () => {
      expect(toStoredOption(undefined)).toBe('');
    });

    it('leaves a real value alone', () => {
      expect(toStoredOption('XL')).toBe('XL');
    });

    /**
     * The round trip, which is the property the two functions owe each other.
     * An option that goes in absent comes back absent, through a column that
     * cannot hold absence.
     */
    it('round trips an absent option back to absent', () => {
      const stored = toStoredOption(undefined);
      const dto = toProductVariantDto(row({ size: stored }));

      expect(dto.size).toBeUndefined();
    });
  });
});
