# 15. Deleting a product is soft, disabling it is not the same thing

Status: accepted
Date: 2026-08-28

## Context

Order history points at variants of products that may since be withdrawn. Three states must
stay distinct: deleted is 404 for everyone, disabled is 404 for everyone except a manager, and
out of stock is visible with a variant at zero.

## Options

- `deleted_at` on the product, a hard delete on the variant (chosen).
- A hard delete on the product: order history loses its target.
- A soft delete on the variant too: nothing points at a variant yet.

## Decision

`visibleProductWhere` holds the rule, and both reads call it. Manager writes resolve through
`assertProductExists` on `NOT_DELETED` alone, so a manager can edit a product they disabled.
`deleteVariant` counts `order_items` first and catches `P2003` for a row that lands between
the two statements, the 409 the contract declares.

## Consequences

**Gives up:** deleted rows stay in the table.
