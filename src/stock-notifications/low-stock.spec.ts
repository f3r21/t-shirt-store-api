import { crossesLowStock, LOW_STOCK_THRESHOLD } from './low-stock';

/**
 * The rule at its boundaries, as literals and not as expressions on the
 * constant, so a change to the threshold or to the comparison turns a case
 * red rather than moving the cases with it.
 */
describe('crossesLowStock', () => {
  it('is three', () => {
    expect(LOW_STOCK_THRESHOLD).toBe(3);
  });

  it.each([
    [4, 3],
    [4, 2],
    [10, 0],
    [4, 0],
  ])('fires when a write takes the stock from %i to %i', (before, after) => {
    expect(crossesLowStock({ variantId: 1, before, after })).toBe(true);
  });

  it.each([
    [3, 2],
    [3, 3],
    [5, 4],
    [2, 3],
    [0, 3],
    [4, 4],
    [1, 10],
  ])('stays quiet from %i to %i', (before, after) => {
    expect(crossesLowStock({ variantId: 1, before, after })).toBe(false);
  });
});
