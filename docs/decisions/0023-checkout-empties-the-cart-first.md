# 23. Checkout empties the cart first, and a status move is a conditional write

Status: accepted, revised 2026-09-04
Date: 2026-09-01

## Context

Two writes could race with themselves: two checkouts of one cart, and a client's cancel
against a manager's ship on one order.

## Options

- Statement order inside one transaction, and `updateMany` with the old status in its `where`
  (chosen).
- `SELECT ... FOR UPDATE` through raw SQL: the same guarantee in a statement Prisma cannot
  type.
- A read then a write for the status: the second write overwrites the first.

## Decision

Checkout reads the lines, checks stock, deletes exactly those lines, then creates the order.
A delete count below the read count is a 409. Under read committed the second checkout
blocks, deletes nothing and rolls back. Snapshots come from the rows the check saw. Checkout
reads stock and never writes it, because the webhook lowers it. A status move writes only if
the status is still the one the table saw; zero rows is a 409, and the history row is in the
same transaction.

## Consequences

**Gives up:** `subtotal` equals `total`, since no promo code exists. **Revised 2026-09-04:** a
promo code exists. `createOrder` takes an optional code, and the two amounts now differ by the
discount on any order that used one. They are still equal on every order that did not, and on
every order a payment link created. ADR 37.

**Revised 2026-09-04, when Optional Feature 13 landed:** the checkout transaction gained one
more step. After the subtotal and before the order row, a named code is read, checked against
its four rules, and counted with a guarded increment. A refusal throws, so the transaction
rolls back and the cart the delete emptied comes back with it. The statement order this record
decided is unchanged. ADR 37.

**Revised 2026-09-03, from a test written by hand:** a cancel of a `paid` or `processing`
order gave nothing back, and the webhook is the only writer that lowers stock. The cancel now
adds each line's quantity back in the same transaction, one atomic increment per line. After
an oversold sale the shelf was already wrong and `stock.oversold` is the reconciliation
trigger, so the cancel restores the quantity and not what was taken; the manager's stock count
corrects that case.
