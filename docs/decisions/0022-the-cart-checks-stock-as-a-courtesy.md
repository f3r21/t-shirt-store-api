# 22. The cart shows what can be bought, and checks stock as a courtesy

Status: accepted, revised 2026-09-03
Date: 2026-09-01

## Context

The contract says a cart is a live view: each line reads its variant's price now. It says
nothing about a product withdrawn after it was added, or about two adds racing past the
stock.

## Options

- Filter lines through `visibleProductWhere`, check stock before the write, no transaction
  (chosen).
- Show a withdrawn line with its stock: the cart becomes the one place a 404 product is
  visible.
- A conditional update on stock: a guarantee `createOrder` gives again anyway.

## Decision

A line for a product no longer on sale leaves the view. The row stays until the user removes
it, and the delete resolves by id alone. Both writes compare the resulting quantity with the
units on hand and throw `insufficient-stock` before touching the row. The order is where the
number has to be right, and an unpaid order reserves nothing.

## Consequences

**Gives up:** a cart can briefly hold more than the shelf, reported through `stock`. No promo
code, tax or delivery charge, so `subtotal` is the sum of the lines.

**Revised 2026-09-03, from a test written by hand:** the add read the line and wrote the sum,
so two adds in the same moment kept one. The write is now an atomic increment on the row, and
the read feeds the stock check only. ADR 34.
