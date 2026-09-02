import type {
  Order as OrderRow,
  OrderItem as OrderItemRow,
  OrderStatusChange as OrderStatusChangeRow,
} from '../generated/prisma/client';
import type {
  CustomerRow,
  OrderWithDetail,
  OrderWithSummary,
} from './order.mapper';

/**
 * Fixed rows, so two calls in one test return the same values and an
 * assertion on a number is explicit. The fixture client of
 * `products.fixtures.ts` (`AS_CLIENT`, id 128) placed the order, for two of
 * the fixture variant at its fixture price.
 */
export function anOrder(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 501,
    userId: 128,
    status: 'pending',
    subtotalCents: 3998,
    totalCents: 3998,
    paymentMethod: null,
    createdAt: new Date('2026-08-15T18:22:00.000Z'),
    ...overrides,
  };
}

export function anOrderLine(
  overrides: Partial<OrderItemRow> = {},
): OrderItemRow {
  return {
    orderId: 501,
    variantId: 21,
    productId: 7,
    productName: 'Nerdery classic tee',
    size: 'M',
    color: 'black',
    unitPriceCents: 1999,
    quantity: 2,
    ...overrides,
  };
}

export function aStatusChange(
  overrides: Partial<OrderStatusChangeRow> = {},
): OrderStatusChangeRow {
  return {
    id: 1,
    orderId: 501,
    status: 'pending',
    changedAt: new Date('2026-08-15T18:22:00.000Z'),
    ...overrides,
  };
}

export function aCustomer(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: 128,
    email: 'ana@example.com',
    firstName: 'Ana',
    lastName: 'Ramirez',
    ...overrides,
  };
}

/** A detail row as `ORDER_DETAIL_INCLUDE` loads it: one line, one history row. */
export function anOrderWithDetail(
  overrides: Partial<OrderWithDetail> = {},
): OrderWithDetail {
  return {
    ...anOrder(),
    items: [anOrderLine()],
    statusHistory: [aStatusChange()],
    user: aCustomer(),
    ...overrides,
  };
}

/** A list row as `ORDER_SUMMARY_INCLUDE` loads it. */
export function anOrderWithSummary(
  overrides: Partial<OrderWithSummary> = {},
): OrderWithSummary {
  return {
    ...anOrder(),
    items: [{ quantity: 2 }],
    user: aCustomer(),
    ...overrides,
  };
}
