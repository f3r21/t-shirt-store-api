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
 * What a requested move is, before anything is written.
 *
 * - `ok`: write it.
 * - `forbidden`: the caller's role may not send this status at all. A client
 *   may only cancel. 403.
 * - `not-cancellable`: a cancel after the order shipped. 409 with the
 *   `order-not-cancellable` problem type, the one 409 the contract names here.
 * - `illegal`: the current status does not allow this move. 409.
 */
export type MoveVerdict = 'ok' | 'forbidden' | 'not-cancellable' | 'illegal';

/** The one forward step a manager may take from each status. */
const MANAGER_ADVANCES: Partial<Record<OrderStatus, RequestableStatus>> = {
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
 * `cancelled` reachable before `shipped`. A manager advances from `paid`, not
 * from `pending`: an unpaid order has nothing to process, and the webhook is
 * the only writer of `paid`, so `pending` to `processing` is illegal rather
 * than a shortcut. `cancelled` and `delivered` are terminal.
 *
 * The role check comes first for anything but a cancel, so a client sending
 * `shipped` reads 403 whatever the order's status, and never learns from a 409
 * which moves the order would have allowed a manager.
 */
export function nextStatus(
  role: string,
  from: OrderStatus,
  to: RequestableStatus,
): MoveVerdict {
  if (to === 'cancelled') {
    if (CANCELLABLE.has(from)) return 'ok';
    if (SHIPPED_OR_LATER.has(from)) return 'not-cancellable';
    return 'illegal';
  }
  if (role !== 'manager') return 'forbidden';
  return MANAGER_ADVANCES[from] === to ? 'ok' : 'illegal';
}
