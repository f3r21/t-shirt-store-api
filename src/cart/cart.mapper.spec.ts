import { anImage } from '../products/products.fixtures';
import { aCartLine } from './cart.fixtures';
import { toCartDto, toCartItemDto } from './cart.mapper';

describe('toCartItemDto', () => {
  it('reads every field from the variant and its product, now', () => {
    const dto = toCartItemDto(aCartLine());

    expect(dto).toEqual({
      variantId: 21,
      productId: 7,
      productName: 'Nerdery classic tee',
      size: 'M',
      color: 'black',
      unitPrice: 1999,
      quantity: 2,
      lineTotal: 3998,
      stock: 7,
    });
  });

  it('carries exactly the keys the contract names, and no row column', () => {
    const dto = toCartItemDto(aCartLine({ images: [anImage()] }));

    // `userId`, `createdAt` and the product's `deletedAt` must not travel. The
    // sorted key list is the whole contract shape, so a spread of any row would
    // fail here rather than leak silently.
    expect(Object.keys(dto).sort()).toEqual(
      [
        'color',
        'imageUrl',
        'lineTotal',
        'productId',
        'productName',
        'quantity',
        'size',
        'stock',
        'unitPrice',
        'variantId',
      ].sort(),
    );
  });

  it('omits a size or colour stored as the empty string', () => {
    const dto = toCartItemDto(aCartLine({ variant: { size: '', color: '' } }));

    expect(dto).not.toHaveProperty('size');
    expect(dto).not.toHaveProperty('color');
  });

  it('carries the primary image url when the include returned one', () => {
    const dto = toCartItemDto(
      aCartLine({
        images: [anImage({ url: 'https://cdn.tshirt.store/products/7/a.jpg' })],
      }),
    );

    expect(dto.imageUrl).toBe('https://cdn.tshirt.store/products/7/a.jpg');
  });

  it('omits imageUrl when the product has no primary image', () => {
    expect(toCartItemDto(aCartLine())).not.toHaveProperty('imageUrl');
  });

  it('multiplies the price now by the quantity', () => {
    const dto = toCartItemDto(
      aCartLine({ row: { quantity: 3 }, variant: { priceCents: 2500 } }),
    );

    expect(dto.unitPrice).toBe(2500);
    expect(dto.lineTotal).toBe(7500);
  });
});

describe('toCartDto', () => {
  it('answers an empty cart for no rows, not a 404', () => {
    expect(toCartDto([])).toEqual({ items: [], subtotal: 0 });
  });

  it('sums the line totals into the subtotal', () => {
    const dto = toCartDto([
      aCartLine({
        row: { quantity: 2 },
        variant: { id: 21, priceCents: 1999 },
      }),
      aCartLine({ row: { quantity: 1 }, variant: { id: 22, priceCents: 500 } }),
    ]);

    expect(dto.items.map((item) => item.lineTotal)).toEqual([3998, 500]);
    expect(dto.subtotal).toBe(4498);
  });
});
