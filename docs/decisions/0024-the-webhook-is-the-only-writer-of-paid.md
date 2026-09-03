# 24. The webhook is the only writer of `paid`, and a retry is a unique violation

Status: accepted, revised 2026-09-03
Date: 2026-09-01

## Context

Stripe holds half of every payment's state, a link purchase fires two events, and Stripe
retries any non-2xx answer.

## Options

- One event kind per flow, the event id inserted first, then one conditional order write
  (chosen).
- The order id on both the link and its intent: a race decides the recorded method.
- Reserve stock at intent creation: needs an expiry and a sweeper.

## Decision

The link carries the order id in its own `metadata` and nothing in `payment_intent_data`. The
event id is inserted into `stripe_events` first, so a replay loses on the primary key.
`updateMany` moves `pending` to `paid`, and zero rows is 200 with a warning. Stock floors at
zero with a `stock.oversold` warning, because the money is already taken. Only a signature
failure is 400, and the e2e factory keeps that check while it stubs the API.

## Consequences

**Gives up:** two intents per order, and a double charge is a refund, which no operation
performs. A crash between the order and the link leaves a pending order with no link.

**Revised 2026-09-02, from a test written by hand:** a session completes `unpaid` for a
delayed method, and the handler paid it. It now pays only when `payment_status` is `paid`,
keeps the event row and warns `payment.unpaid-session`.

**Revised 2026-09-03, from a test written by hand:** the floor to zero was an unguarded write
after a read, so a restock landing in between was discarded. The floor now carries the stock
it read, zero rows starts the round again from the decrement, and a third miss throws so the
transaction rolls back and Stripe retries. ADR 34.

**Switch:** handle `checkout.session.async_payment_succeeded` when a delayed method is
enabled.
