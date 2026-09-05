# 37. Promo codes count at checkout and snapshot on the order

Status: accepted, revised 2026-09-04
Date: 2026-09-04

## Context

Optional Feature 13 has two halves. The manager's half shipped first and carries no record of
its own: the `promo_codes` table, the three operations, and `used_count` with nothing that
writes it. This record is the client's half. A client sends a code at checkout, the server checks four rules,
the discount comes off the subtotal, and the order history shows what was applied.

Three questions had no obvious answer. What a discount does to the arithmetic when it does not
divide evenly. When a use is counted, and what happens to the count when the order that took it
is cancelled. And what the order stores, given that a manager can rename or reprice a code
afterwards.

## Options

- **Three columns on `orders`: the foreign key, the code as text, and the discount amount**
  (chosen). The key ties the order to the row `used_count` counts, the text is the history, and
  the amount is what the contract's `discount` member returns.
- **The foreign key alone**, and read the code and the discount through the join. One column
  fewer, and every order in the history would show the code's current name and current value.
  That is the bug `unit_price_cents` on a line already exists to prevent.
- **The text alone**, with no key. Nothing then connects `used_count` to the orders behind it,
  and a manager reading `usedCount: 40` could not find the forty.
- **A `promo_code_uses` table**, one row per use. It carries no fact the three columns do not,
  because an order uses at most one code, and it makes the count a query rather than a column.

For the count itself:

- **Count at order creation, inside the checkout transaction, as a guarded increment**
  (chosen). ADR 34's shape: the limit the read saw goes into the `WHERE`.
- **Count at payment**, in the webhook. A code with one use left would then be claimable by any
  number of unpaid orders at once, and the limit would mean nothing until money moved.

## Decision

**The arithmetic rounds down, in the buyer's favour and never past zero.** A percentage
discount is `floor(subtotal * value / 100)`, so 10 percent of 1999 is 199 and not 200: the
store never gives away more than the share the code names, and a discount is always a whole
minor unit, which ADR 13 requires. A fixed discount is `min(value, subtotal)`, so a code worth
more than the cart takes the cart to zero and no further. `total = subtotal - discount`, and
both amounts stay at or above zero, which is what the contract's `Money` states.

**A use is counted when the order is created, in the same transaction, and it is not given
back.** The count is a guarded increment: `updateMany` with `usedCount: { lt: usageLimit }` in
the `where` when the code carries a limit, and a plain increment when it does not. Zero rows is
`promo-code-exhausted`. That is the whole of the exhaustion rule, the ordinary case and the
race alike: two checkouts arriving together for the last use both read a code with room, the
loser blocks on the winner's update, and Postgres re-reads the condition against the committed
value, which no longer satisfies it. A refusal anywhere in the checkout rolls the increment
back with the rest of the transaction, so a refused order counts nothing.

Counting at creation means a cancelled order keeps its use. That is deliberate. A limit of 100
on a launch code is a budget, and letting a cancel refund the budget hands a scripted client an
unlimited code: place, cancel, repeat. The store loses at most a few uses to genuine cancels
and keeps the guarantee that the number can never be exceeded. **The switch:** when a code's
limit is large enough that abandoned orders visibly waste it, or a manager asks why `usedCount`
is above the orders that show the code, the change is a decrement in the cancel branch of
`setOrderStatus` guarded on `usedCount > 0`, paired with a rule that a code can be applied once
per client.

**A per-user limit was rejected.** The brief lists one limit and calls it the total uses
allowed. A per-user rule needs a column the brief does not describe and a second count to keep.
It is the obvious next feature and it is not this one.

**The order stores the code as the store holds it, not as the buyer typed it.** The column is
`citext`, so a client may send `save10` for a code a manager created as `SAVE10`. The order
records `SAVE10`, which is the one spelling that names the code, and it records the discount in
minor units rather than the percentage. A later rename or reprice therefore changes no order
already placed.

**The four refusals are 422, each with its own problem type.** The body is well formed and the
server refuses it on its content, which is the reading `assertAllExist` already makes for a
category that names no row. A client shows a different message for each, so the status alone
is not enough: `promo-code-unknown` covers both a code that does not exist and one a manager
disabled, because telling those apart would confirm which codes exist to anybody who guesses.

**The verb is `apply`, and it is asked at the controller.** ADR 25 puts the decision there, so
the policy on `createOrder` reads the request body and asks for `apply PromoCode` only when the
body names a code. Every signed-in caller holds the verb today, which is the brief's grant of
promo codes to a client on their own orders, so nothing is refused yet. The check is what makes
that grant enforced instead of a line in the ability nothing reads, and it fails closed for a
role added later without it.

**A payment intent below the provider's minimum is refused with 409.** Stripe's `amount` is a
positive integer whose minimum for USD is 50 minor units, so a total of 49 can no more be sent
than a total of 0, and a discount reaches both. The bound is a property of the currency, so it is
`STRIPE_MINIMUM_CENTS` beside `CURRENCY` in the gateway, and `createPaymentIntent` compares the
order's total against it before it calls Stripe rather than handing over a value the API rejects
with an error nothing maps. A second currency turns the constant into a lookup.

## Consequences

**Gives up:** an order whose total is under the provider's minimum cannot leave `pending`
through the payment flow. The webhook is the only writer of `paid` (ADR 24) and no event will
arrive for a payment nobody made, so the order waits for a manager or for the client to cancel
it. A catalog priced above 50 minor units a unit reaches this only through a discount, which is
why it arrives with promo codes. **The switch:** an operation that settles such an order,
writing `paid` with a payment method of its own, which is a third value in a set the contract
currently closes at two.

**Gives up:** payment links carry no promo code. The brief says a code is applied at checkout,
and a link sells one product outside the cart, so `createPaymentLink` still writes
`subtotal_cents` and `total_cents` equal with a discount of zero.

**Gives up:** no index on `orders.promo_code_id`. Nothing reads an order by its code, and the
only lookup `ON DELETE RESTRICT` performs is on a delete this API never offers. A manager turns
a code off instead, which is what the brief asks for.

**Revised 2026-09-04:** the three read-only rules, the rounding and the four refusals live in
`src/promo-codes/promo-code-rules.ts`, a pure module beside the manager's operations, with a
spec of direct calls in place of a checkout that reached the arithmetic through the data of
`order.create`. The clock the expiry rule reads is a parameter, which is what makes the
boundary a pair of literals. The lookup and the guarded count stay inside checkout's
transaction, where this record and ADR 34 put them, so no transaction client crosses the new
edge and nothing about the decisions above changes.
