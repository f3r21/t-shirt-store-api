# 23. Checkout empties the cart first, and a status move is a conditional write

Status: accepted
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
blocks, deletes nothing and rolls back. Snapshots come from the rows the check saw. Stock is
read and never written here, because the webhook lowers it. A status move writes only if the
status is still the one the table saw; zero rows is a 409, and the history row is in the same
transaction.

## Consequences

**Gives up:** `subtotal` equals `total`, since no promo code exists.
