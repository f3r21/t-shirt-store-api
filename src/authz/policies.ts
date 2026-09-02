import type { Action } from './ability';
import type { AppSubjects } from './casl-prisma';
import type { Policy } from './check-policies.decorator';

/** A subject named by its model, the form a guard can check before any read. */
export type SubjectName = Extract<AppSubjects, string>;

/**
 * May the caller do this to this kind of thing at all.
 *
 * Type-level on purpose: a guard runs before the row is read, so it can only
 * ask about the subject type, and CASL answers yes when any rule allows the
 * action on some instance. The condition on the rule, "own", becomes the
 * `where` in the service through `accessibleBy`, which is where the row is.
 */
export const can =
  (action: Action, subject: SubjectName): Policy =>
  (ability) =>
    ability.can(action, subject);

/**
 * `setOrderStatus` serves two callers with two verbs: a client cancels, a
 * manager advances. Either ability opens the route; the service asks the
 * exact question once it has the row and the requested status.
 */
export const updateOrCancelOrder: Policy = (ability) =>
  ability.can('update', 'Order') || ability.can('cancel', 'Order');

/**
 * The disabled products are a manager's to see, and the contract answers the
 * request for them with 401 or 403 depending on who asked. The guard runs
 * before the pipe, so the flag is read raw: the pipe accepts `true` and
 * `false` and nothing else, and anything else fails validation after this.
 */
export const inactiveProductsNeedManager: Policy = (ability, request) =>
  request.query.includeInactive !== 'true' || ability.can('update', 'Product');
