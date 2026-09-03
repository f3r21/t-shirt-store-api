/**
 * The low-stock rule: a downward crossing of the threshold, never a rise, per
 * variant because the like is per variant. `stock_notifications` keeps an
 * oscillating stock from mailing a person twice. ADR 27.
 */
export const LOW_STOCK_THRESHOLD = 3;

/** One stock write, as both writers report it: the value before and after. */
export interface StockChange {
  variantId: number;
  before: number;
  after: number;
}

export function crossesLowStock(change: StockChange): boolean {
  return (
    change.before > LOW_STOCK_THRESHOLD && change.after <= LOW_STOCK_THRESHOLD
  );
}
