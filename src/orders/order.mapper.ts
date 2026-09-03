import type { Prisma } from '../generated/prisma/client';
import type {
  Order as OrderRow,
  OrderItem as OrderItemRow,
  OrderStatusChange as OrderStatusChangeRow,
} from '../generated/prisma/client';
import type { AccessTokenPayload } from '../auth/access-token-payload';
import { isManager } from '../products/product-visibility';
import type {
  OrderCustomerDto,
  OrderDto,
  OrderItemDto,
  OrderStatusChangeDto,
} from './dto/order.dto';
import type { OrderSummaryDto } from './dto/order-summary.dto';

/** The four columns of `users` a manager sees on an order, and no more. */
const CUSTOMER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
} satisfies Prisma.UserSelect;

export type CustomerRow = {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
};

/** An order row with everything the detail response names. */
export type OrderWithDetail = OrderRow & {
  items: OrderItemRow[];
  statusHistory: OrderStatusChangeRow[];
  user: CustomerRow;
};

/** An order row with what a list entry needs: the unit counts and the client. */
export type OrderWithSummary = OrderRow & {
  items: { quantity: number }[];
  user: CustomerRow;
};

/**
 * What a detail read loads for `toOrderDto` to be satisfiable.
 *
 * The history is ordered by `changedAt` and then by id, because two rows
 * written in one transaction share an instant and the schema comment on the
 * index says the tiebreak belongs in the query. Lines are by variant, so the
 * order is stable across reads.
 */
export const ORDER_DETAIL_INCLUDE = {
  items: { orderBy: { variantId: 'asc' } },
  statusHistory: { orderBy: [{ changedAt: 'asc' }, { id: 'asc' }] },
  user: { select: CUSTOMER_SELECT },
} satisfies Prisma.OrderInclude;

/** What a list read loads: the quantities for `itemCount`, and the client. */
export const ORDER_SUMMARY_INCLUDE = {
  items: { select: { quantity: true } },
  user: { select: CUSTOMER_SELECT },
} satisfies Prisma.OrderInclude;

/**
 * Map one line. The snapshots travel as they were stored; the empty string
 * for an absent option becomes absence, the rule `variant.mapper.ts` records.
 */
export function toOrderItemDto(row: OrderItemRow): OrderItemDto {
  const dto: OrderItemDto = {
    variantId: row.variantId,
    productId: row.productId,
    productName: row.productName,
    unitPrice: row.unitPriceCents,
    quantity: row.quantity,
    lineTotal: row.unitPriceCents * row.quantity,
  };

  if (row.size !== '') {
    dto.size = row.size;
  }
  if (row.color !== '') {
    dto.color = row.color;
  }

  return dto;
}

export function toOrderStatusChangeDto(
  row: OrderStatusChangeRow,
): OrderStatusChangeDto {
  return { status: row.status, changedAt: row.changedAt.toISOString() };
}

function toOrderCustomerDto(row: CustomerRow): OrderCustomerDto {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
  };
}

/**
 * Map a list row to the contract's `OrderSummary`.
 *
 * `customer` is present only for a manager. The function names every field
 * it copies and never spreads the row, so `userId` has no path to a client's
 * response and the four customer columns are the only ones a manager sees.
 */
export function toOrderSummaryDto(
  row: OrderWithSummary,
  viewer: AccessTokenPayload,
): OrderSummaryDto {
  const dto: OrderSummaryDto = {
    id: row.id,
    status: row.status,
    subtotal: row.subtotalCents,
    total: row.totalCents,
    itemCount: row.items.reduce((sum, item) => sum + item.quantity, 0),
    createdAt: row.createdAt.toISOString(),
  };

  if (isManager(viewer)) {
    dto.customer = toOrderCustomerDto(row.user);
  }

  return dto;
}

/** Map a detail row to the contract's `Order`, under the same two rules. */
export function toOrderDto(
  row: OrderWithDetail,
  viewer: AccessTokenPayload,
): OrderDto {
  const dto: OrderDto = {
    id: row.id,
    status: row.status,
    subtotal: row.subtotalCents,
    total: row.totalCents,
    items: row.items.map(toOrderItemDto),
    createdAt: row.createdAt.toISOString(),
    statusHistory: row.statusHistory.map(toOrderStatusChangeDto),
  };

  if (isManager(viewer)) {
    dto.customer = toOrderCustomerDto(row.user);
  }
  if (row.paymentMethod !== null) {
    dto.paymentMethod = row.paymentMethod;
  }

  return dto;
}
