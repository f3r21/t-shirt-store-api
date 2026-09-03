/**
 * The low-stock rule, Feature 8 of the brief: "when the stock of a product
 * reaches 3, notify users who liked the product but haven't purchased it yet".
 *
 * A crossing and not an equality. A purchase of two units from four leaves
 * two and never shows a three, and the brief's intent is a warning before the
 * variant sells out, so the rule fires when a write takes the stock from above
 * the threshold to the threshold or below. Rising stock never fires: a restock
 * from one to three is not low stock. Stock oscillating at the threshold fires
 * on every downward crossing, and `stock_notifications` is what keeps that
 * from mailing a person twice. ADR 27.
 *
 * Per variant, because the like is per variant (ADR 26, and the ERD
 * ledger's decision 15): a customer waiting on one size hears about that size.
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
