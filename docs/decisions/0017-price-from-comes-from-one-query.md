# 17. `priceFrom` comes from one query for the whole page

Status: accepted
Date: 2026-08-28

## Context

The cheapest variant per product is the N+1 this endpoint is most likely to grow, and the
per-row version passes every review.

## Options

- One `groupBy` over the page's ids (chosen).
- A query per row.

## Decision

A test asserts that the call count is one. A product with no variants is absent from the
response, because zero would read as free.

## Consequences

**Gives up:** nothing measurable at this size.
