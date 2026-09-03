# 34. A write that depends on a value it read carries that value, or adds to it

Status: accepted
Date: 2026-09-03

## Context

Four writes computed their value from a row they had read, with no lock and no guard, at
read committed: the cart add, the stock count, the oversold floor and the primary image. A
second writer landing between the read and the write was lost.

## Options

- Guarded writes: a relative write is an atomic `increment` or `decrement`, an absolute
  write names the value it read in its `WHERE`, and a rule that spans rows locks the parent
  row with `SELECT ... FOR UPDATE` (chosen).
- `Serializable` on the four transactions: every caller needs a retry loop for `40001`.
- An advisory lock at every site: raw SQL for what a `WHERE` does.
- A version column: a migration and a field nothing reads.
- A partial unique index for one primary image: `migrate diff --exit-code` in CI flags an
  index the schema cannot express.

## Decision

Postgres re-evaluates an `UPDATE`'s `WHERE` against the row's committed version once a
concurrent writer commits, so a guarded write applies to the value it assumed or matches
nothing. ADR 23 uses this for the status and the webhook for its decrement. The cart add
increments. The stock count and the oversold floor carry the value they read: zero rows is a
409 for the person counting and a retry for the webhook. The primary image locks its product
row.

## Consequences

**Gives up:** no single mechanism; each site names its guard in a comment.

**Switch:** when a fifth site appears, or a second place needs a retry loop, `Serializable`
with one retry helper.
