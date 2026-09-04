# 36. The delivery person reads shipped orders and writes delivered, and one column records who

Status: accepted
Date: 2026-09-04

## Context

Optional Features 11 and 12 add a third role and a sixth reachable status. The role must view
assigned orders, meaning the ones in `shipped`, move an order to `delivered` and nothing else,
and view its delivery history. The `OrderStatus` type already listed `delivered` and the role
row already existed. Neither had a rule, a transition, or a route.

"Assigned" is the word the brief uses, but nothing in the brief assigns an order to anyone.
There is no dispatch step, no round, and no operation that hands an order to a named courier.
The only fact available at the moment of delivery is who was holding the parcel when it was
delivered, which is also the only fact the history needs.

## Options

- **One column that accepts null, `orders.delivered_by_user_id`, written by the `delivered`
  transition** (chosen). The queue is every shipped order, the history is the orders whose
  column names the caller, and both are one filter on a table already indexed for this shape.
- **An assignment table**, `order_id` and `user_id` with a state. It models a dispatch flow the
  brief does not describe, and every row would be written at the same instant the status moves,
  so the extra table would carry no fact the column does not.
- **Read the delivery person off the status history.** `order_status_history` records the status
  and the time, not the actor. Adding an actor column there means either an empty value on
  every row of a table that has never needed one, or a second write to keep in step with the
  first.

## Decision

`orders.delivered_by_user_id` accepts null and references `users(id)` with
`ON DELETE SET NULL`. The order is the record and the delivery person is an attribution on it,
so removing an account must not hold an order hostage, which is the opposite of the `RESTRICT`
on `orders.user_id`. `setOrderStatus` writes the column in the same conditional `updateMany`
that moves the status, so no row can hold `delivered` with no deliverer, and it writes it on
that move alone: the column means `delivered by`, not `last touched by`.

`deliver` is a verb of its own in the ability, for the reason `cancel` is one: the role may make
exactly one move, which `update` cannot express. The role has four rules, two per verb. `read`
covers what this caller may open: an order in `shipped`, and one in `delivered` whose column
names the caller. `deliver` covers the round: the same two sets, and nothing else. They sit
after the signed-in block, because a delivery person is also a user with a cart and orders of
their own.

**The two verbs are not the same set, and that is the point.** `read` widens by the signed-in
block above it, which grants every caller their own orders. `deliver` does not. A delivery
person who also shops here has orders of their own, and one of them can reach `delivered` at a
colleague's hands.

`listDeliveries` at `GET /deliveries` is a scope and not a filter on `/orders`. Its policy asks
`deliver`, so a client is 403 rather than reading an empty page, and the service scopes the
query on `accessibleBy(ability, 'deliver').Order` with the status filter on top. Scoping it on
the read set instead would put that courier's own parcel in their own delivery history, which
is not what "view delivery history" means: the history is the orders this person delivered.
Both `deliver` rules carry their condition, so the history is personal with no second query and
no `userId` parameter a caller could set to somebody else. `getOrder` keeps the read set, so the
courier still opens that order as its customer.

Giving `deliver` the delivered half has one further effect, and it is the honest answer: a
courier re-sending `delivered` on an order they already delivered passes the ability and meets
the transition table, which answers 409. A second courier on the same row is still 404, because
neither verb reaches it.

A manager's `manage Order` covers `deliver` by CASL's own semantics, and `shipped -> delivered`
is a normal arc in `ADVANCES`, so a manager can complete an order when no delivery person did.
That overlap is deliberate: the alternative is a status only one role can ever write, which
strands an order the day nobody is on the round.

**The customer stays manager-only on the delivery list.** `OrderSummary` carries an optional
`customer`, and `toOrderSummaryDto` fills it for a manager alone. A delivery person sees the
order, its total and its unit count, and not the client's name or email address. The reason is
that this API stores no delivery address, so the customer object would be a client's email
handed to a third role for no operational use. **The switch:** the day an order carries an
address, the delivery person needs a name to hand the parcel to, and the right change is a
narrower recipient object on this list, not the existing `customer` with its email.

## Consequences

**Gives up:** no assignment step, so two delivery people can open the same queue and the second
one to arrive at an order finds it delivered. That resolves as a 404 rather than a 409, because
once the order leaves `shipped` the second person's read rules no longer reach it at all and the
ownership rule answers before the status table does. A queue that needs one owner per order
needs the assignment table, and that is the switch: an operation that claims an order, and a
rule that narrows the queue to the caller's claims.

**Gives up:** the history is the caller's own deliveries and nothing else. There is no report of
one delivery person's work for a manager, because the brief asks for none. A manager reading
`GET /deliveries?status=delivered` sees every delivered order, which is the manager's existing
`manage` rule and not a new grant.
