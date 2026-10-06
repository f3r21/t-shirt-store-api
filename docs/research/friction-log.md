# Friction log: a first paid order from the docs alone

One developer who has never seen this repository tries to buy a t-shirt through the API, using
only the README and Swagger UI. The run measures how long the first call takes and how long a
paid order takes. It also records every point where the developer got stuck. It tests the
assumption in `docs/product.md` that the second user of this API is the developer calling it.
It is a single run, not a study.

## Why this shape

- **The first call is the first payoff.** Postman calls time to first call "the most important
  API metric", and says it can be measured "subjectively with usability testing and user
  feedback" (<https://blog.postman.com/the-most-important-api-metric-is-time-to-first-call/>).
- **A friction log records the trip, not a score.** Stripe's developer-platform team had people
  "try to use a new thing and document all the friction along the way"
  (<https://kenneth.io/post/insights-from-building-stripes-developer-platform-and-api-developer-experience>).
  The template has four parts: Context, Pros, Cons, and Stream of consciousness
  (<https://github.com/mikeb-stripe/friction-logging-toolkit>).

## Setup

- **Target.** The deployed store, if it is up, at `<ApiUrl>/v1`, with Swagger UI at
  `<ApiUrl>/docs`. Otherwise the participant runs it locally from the README's "Run it", and the
  setup time is logged as its own step.
- **What the participant gets.** The repository link, the base URL, and this sentence: "Buy one
  t-shirt through the API and get the order to `paid`. Use the README and Swagger. Think aloud."
  No other help.
- **Payment.** It goes through the payment link (`POST /v1/payment-links`). Stripe hosts the
  page, so the participant pays with the test card `4242 4242 4242 4242`, any future date and
  any CVC, and needs no Stripe account. The order turns `paid` when the
  `checkout.session.completed` event reaches the webhook.
- **Recording.** Screen and voice, only with consent. The observer writes timestamps and says
  nothing, except "what are you thinking?" after 20 seconds of silence.
- **Time box.** 30 minutes. A run that stops there is a result too.

## Dependencies

The run cannot start until these hold. Check them the day before, not with the participant
watching.

- **A product to buy.** M3 needs a variant with stock, and a fresh store has none. The seed
  creates no products in any environment, and in production it creates roles and categories
  only (`prisma/seed.ts:61-62`). Only a manager can create a product, and the API cannot
  create a manager. On the deployed store an operator reruns the seed with
  `SEED_MANAGER_EMAIL` (README, "Deploy", step 4), then signs in as that manager and creates
  one product, one variant and its stock. Locally, the seed's demo manager does the same.
  Without this step M3 is impossible, and the run measures the setup, not the docs.
- **A reachable store.** Either the deployed URL answers, or the participant's machine has
  Docker and Node 22 for the README's "Run it".
- **Stripe test mode.** The store holds `sk_test_` keys and the webhook endpoint is added in
  the Stripe dashboard for `checkout.session.completed` (README, "Stripe"). Otherwise M5
  never arrives.

## Milestones

| # | Milestone | Done when | Clock |
|---|---|---|---|
| M1 | First successful call | Any 2xx, for example `GET /v1/products` without signing in | time to first call |
| M2 | Signed in | `POST /v1/users`, then `POST /v1/auth/sessions` returns an access token | |
| M3 | A variant chosen | The participant has a `variantId` with stock | |
| M4 | Payment link | `POST /v1/payment-links` returns 201 and a Stripe URL | |
| M5 | Paid | `GET /v1/orders/{id}` shows `paid` after paying on Stripe's page | time to paid order |

## Log

Fill this in during the run. Interpretation goes in "Findings".

### Context

- Participant: D1, years of backend experience: __, has used Stripe before: yes / no.
- Target: deployed / local. Date: ____.

### Stream of consciousness

| mm:ss | What they did or said | Where (README section, Swagger operation, response) |
|---|---|---|
| | | |

### Milestone times

| M1 | M2 | M3 | M4 | M5 |
|---|---|---|---|---|
| | | | | |

### Pros

-

### Cons

-

## Findings

| # | Friction | Cost (minutes lost) | Severity 0-4 | Fix belongs in (README, contract, error body, code) |
|---|---|---|---|---|
| F1 | | | | |

Severity uses the 0-4 scale from Nielsen Norman Group:
<https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/>.

### What changes because of this

- In `docs/product.md`: whether the calling developer stays a persona, and what they need first.
- In `docs/qa/risk-register.md`: any new risk.
- In the README: the line each finding says was missing.
