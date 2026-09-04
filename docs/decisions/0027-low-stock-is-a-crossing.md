# 27. Low stock is a crossing, the producer decides after the commit, and it is one job per person

Status: accepted
Date: 2026-09-02

## Context

Feature 8 mails the users who liked a product when its stock reaches 3, from a background
job. A purchase of two units from four never shows a three. BullMQ is at-least-once and
retries per job.

## Options

- Fire on a downward crossing of 3, one job per recipient, after the commit (chosen).
- Fire on equality: misses most sales.
- One job per variant: a job dying halfway resends everything before it.
- An enqueue inside the transaction: a queue outage fails a paid order.
- pg-boss: it adds no service, and pays for that by polling the Postgres that is already the
  ceiling.

**Revised 2026-09-04:** the pg-boss option moved here from `ARCHITECTURE.md`, which is one
page and keeps the RabbitMQ comparison only.

## Decision

`crossesLowStock` fires when a write takes the stock from above three to three or below, and
both stock writers call `LowStockProducer.notify` after their own write. The audience is
three clauses on the user: liked the variant, no `stock_notifications` row, no line in an
order that is not `pending` or `cancelled`. The job id is `low-stock:<variant>:<user>`, so
two crossings before the worker runs leave one job. `notify` catches everything and logs
`stock.notify-failed`.

## Consequences

**Gives up:** a crash between the commit and the enqueue loses the job. The request id does
not travel in the job.

**Switch:** when a variant has thousands of likes, the producer itself becomes a job.
