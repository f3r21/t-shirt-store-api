# 26. A like needs a product on sale, an unlike needs only a variant, and the list is the product page

Status: accepted
Date: 2026-09-02

## Context

The contract says a liked-products entry has the shape of a product-list entry, and a product
with two liked variants appears once. A like placed while a product was on sale must stay
removable after a manager disables it.

## Options

- Like through `visibleProductWhere`, unlike through `NOT_DELETED`, list through
  `ProductsService.pageOf` (chosen).
- One rule for both: a like on a hidden product, or an unlike refused after a disable.
- A second mapper for the list: the same page assembled twice.

## Decision

`pageOf(where, query)` assembles both lists, and the likes service adds
`variants: { some: { likes: { some: { userId } } } }`, so one row per product is a property of
the predicate. The row is the pair and nothing else, which makes `PUT` an `upsert` and
`DELETE` a `deleteMany`. The rule is `manage ProductLike` on the caller's own `userId`, for
every role.

## Consequences

**Gives up:** no like count. An unlike on a deleted product's variant is a 404, so a like that
outlives a deletion is one unreachable row.
