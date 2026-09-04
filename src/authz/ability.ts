import type { PureAbility } from '@casl/ability';
import type { AppSubjects, PrismaQuery } from './casl-prisma';

/**
 * The verbs the abilities speak.
 *
 * Five are CASL's own, and `manage` is its alias for every action: a rule
 * granting `manage` covers any check, and a check for `manage` passes only a
 * `manage` rule, which is what makes "view all orders" expressible for a
 * manager beside "read my orders" for a client. `cancel` and `pay` are the
 * brief's verbs for the two things a client does to an order that are not an
 * update, which is the manager's advance through the status flow.
 *
 * `deliver` is the delivery person's one write, and it is a verb of its own
 * for the same reason `cancel` is: the role may move an order to `delivered`
 * and to nothing else, which `update` cannot say. A manager's `manage Order`
 * covers it without a rule of its own. ADR 36.
 *
 * `apply` is the brief's own verb for what a client does with a promo code at
 * checkout, and it is not `read`: a client never opens the code, and `read`
 * would grant the manager's list. A manager's `manage PromoCode` covers it.
 * ADR 37.
 */
export type Action =
  | 'manage'
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'cancel'
  | 'pay'
  | 'deliver'
  | 'apply';

/** An ability whose conditions are Prisma where clauses on our own models. */
export type AppAbility = PureAbility<[Action, AppSubjects], PrismaQuery>;
