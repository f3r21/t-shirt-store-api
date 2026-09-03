import type { OrderStatus } from '../generated/prisma/enums';

/**
 * The statuses `setOrderStatus` accepts. `pending` is where an order starts,
 * `paid` is the webhook's alone, and `delivered` belongs to the optional
 * delivery feature.
 */
export const REQUESTABLE_STATUSES = [
  'processing',
  'shipped',
  'cancelled',
] as const;

export type RequestableStatus = (typeof REQUESTABLE_STATUSES)[number];

/**
 * What a requested move is from the current status: `ok`, `not-cancellable`
 * (a cancel after shipping, the contract's own 409 type), or `illegal`. Who
 * may ask is the ability's business, answered before this table.
 */
export type MoveVerdict = 'ok' | 'not-cancellable' | 'illegal';

/** The one forward step from each status. */
const ADVANCES: Partial<Record<OrderStatus, RequestableStatus>> = {
  paid: 'processing',
  processing: 'shipped',
};

/** Where a cancel is still possible: before the order ships. */
const CANCELLABLE: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'pending',
  'paid',
  'processing',
]);

/** Where a cancel is refused with its own problem type: the order left. */
const SHIPPED_OR_LATER: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'shipped',
  'delivered',
]);

/**
 * The status flow as one pure function: `pending, paid, processing,
 * shipped`, with `cancelled` reachable before `shipped`. An advance goes from
 * `paid`, because the webhook is the only writer of it. `cancelled` and
 * `delivered` are terminal.
 */
export function nextStatus(
  from: OrderStatus,
  to: RequestableStatus,
): MoveVerdict {
  if (to === 'cancelled') {
    if (CANCELLABLE.has(from)) return 'ok';
    if (SHIPPED_OR_LATER.has(from)) return 'not-cancellable';
    return 'illegal';
  }
  return ADVANCES[from] === to ? 'ok' : 'illegal';
}
