# 13. Money is an integer column named for what it holds

Status: accepted
Date: 2026-08-28

## Context

The ERD says `numeric(10,2)`. The contract types Money as an integer in minor units, and
Prisma 7 hands a `numeric` column back as a `Decimal` that serialises to a string.

## Options

- `price_cents` as `Int` (chosen).
- `numeric(10,2)` as the ERD says: a conversion inbound, outbound and at Stripe.

## Decision

1999 means 19.99. No conversion anywhere, and Stripe speaks minor units too. The column is
named `price_cents` because a column named `price` holding 1999 misleads the next reader.

## Consequences

**Gives up:** the schema departs from the ERD. Sub-cent precision needs a migration.
