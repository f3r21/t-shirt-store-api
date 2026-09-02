import type { OrderStatus } from '../generated/prisma/enums';

/**
 * The statuses a caller may send. See `openapi.yaml:1530-1586`.
 *
 * `pending` is where an order starts, `paid` is written by the payment webhook
 * alone because Stripe confirms a payment and a request does not, and
 * `delivered` belongs to the optional delivery feature the contract leaves out.
 */
export const REQUESTABLE_STATUSES = [
  'processing',
  'shipped',
  'cancelled',
] as const;

export type RequestableStatus = (typeof REQUESTABLE_STATUSES)[number];

/**
 * What a requested move is, given the order's current status.
 *
 * - `ok`: write it.
 * - `not-cancellable`: a cancel after the order shipped. 409 with the
 *   `order-not-cancellable` problem type, the one 409 the contract names here.
 * - `illegal`: the current status does not allow this move. 409.
 *
 * Who may ask is not this table's business. The ability decides that before
 * the table is consulted: a client may cancel their own order and a manager
 * may advance any, and the service answers 403 from the ability, then 409
 * from here.
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
 * The status flow, as one pure function the service asks before it writes.
 *
 * The brief's core flow is `pending, paid, processing, shipped`, with
 * `cancelled` reachable before `shipped`. An advance goes from `paid`, not
 * from `pending`: an unpaid order has nothing to process, and the webhook is
 * the only writer of `paid`, so `pending` to `processing` is illegal rather
 * than a shortcut. `cancelled` and `delivered` are terminal.
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
