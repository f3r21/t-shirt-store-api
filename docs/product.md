# Product

**Call: not ready for real money today. Ready for a Stripe test-mode pilot with one developer.**
The evidence is in "Go or no-go" below. Written on 2026-10-06, after the build, from sources
dated in this repository. The user and the likelihoods are assumptions until the friction log runs.

## Who it is for (assumption)

**D1, the developer who integrates the store.** D1 builds the shop front or the mobile app that
calls this API. D1 reads the contract and Swagger UI, not the code, and decides what the shopper
sees from the status code and the problem type. Nobody has been interviewed. D1 is rebuilt from
reasoning written while the API was built:

| What D1 needs | Where it was written, and when |
|---|---|
| To tell an expired token from a wrong password, or the app "loops between refreshing and the sign-in screen" | ADR 5, 2026-08-28 |
| One value to branch on: "A client branches on this value and on nothing else" | `contract/openapi.yaml:2071`, 2026-08-28 (`43b7995`) |
| To tell three 409 answers apart "to show the right message" | `contract/openapi.yaml:2087`, 2026-08-28 |
| To know which rule refused a promo code: "a client retypes an unknown code and removes an expired one" | `contract/openapi.yaml:2093`, 2026-09-04 (`3864713`) |
| Their own origin allowed: "a deployment with a front end names it" | ADR 19, 2026-09-01 |

The brief's users, the manager, the client and the delivery person, reach the API only through
D1's software. So D1 is the user these documents serve.

## The problem

D1 has to answer two questions on every failed call: what does the shopper see, and did money
move. When the answers are ambiguous, the app loops on sign-in or shows the wrong message. When a
payment's truth lives in two places, the order and the charge drift apart.

**North Star: paid orders per week.** Each one is a row in `order_status_history` with status
`paid`, and only the signed Stripe webhook writes that status (ADR 24). No dashboard counts it
yet: `ARCHITECTURE.md` says "None of these exists yet".

## What was built, and what was cut

What was built is the MVP: everything on `main`, listed in the README under "What is
implemented". The MoSCoW labels below are applied after the fact.

| MoSCoW | Item | Why |
|---|---|---|
| Must | Accounts and sessions, catalog, cart, an order from the cart, Stripe payment, problem documents | Without any one of them D1 cannot take a shopper to `paid` |
| Must | CASL authorization, a deploy, likes with the low-stock mail | The brief requires them (ADR 25, ADR 29, and "Feature 8" in ADR 27) |
| Should | Rate limiting, product images | Not needed to reach `paid`, needed before strangers use the store |
| Could | Delivery person and `delivered`, promo codes | The brief's Optional Features 11 to 13 |
| Won't | Refunds | "a double charge is a refund, which no operation performs" (ADR 24) |
| Won't | A per-user promo limit | The brief names one limit, the total uses (ADR 37) |
| Won't | Courier dispatch | "nothing in the brief assigns an order to anyone" (ADR 36) |
| Won't | Guest checkout | `orders.user_id` cannot be null (`createPaymentLink` in the contract) |
| Won't | Creating a manager through the API | Only the seed promotes one, with `SEED_MANAGER_EMAIL` (`prisma/seed.ts`) |
| Won't | A transactional outbox | A crash between commit and enqueue loses a low-stock mail, never a payment (`ARCHITECTURE.md`) |
| Won't | Live Stripe | Payments run in test mode (README, "Stripe") |

There is no RICE table. Reach and effort were never measured, and a score built on guessed
numbers is a guessed decision. The friction log is the first measurement. Once it exists, RICE
ranks the "Next" list, with confidence capped at 70%.

## Three risks

Likelihood and impact are judged on a 1 to 3 scale, not measured.

| Risk | L | I | L × I | What limits it |
|---|---|---|---|---|
| D1 cannot reach a paid order alone: a fresh store has no product, and the API cannot create a manager | 3 | 3 | 9 | The friction log's "Dependencies"; README "Deploy", step 4 |
| A shopper pays for a unit that is gone. A pending order holds no stock, so two orders can pay for the last unit; the stock floors at zero and logs `stock.oversold` | 2 | 3 | 6 | The intent checks stock before Stripe is asked. A refund is done by hand in Stripe |
| Mail does not arrive. SES is in its sandbox and the mail lands in spam (README, "Known gaps") | 3 | 2 | 6 | A domain with DKIM |

`docs/qa/risk-register.md` holds the full register.

## Checkout, as acceptance criteria

Each row is one test in `test/checkout.e2e-spec.ts`, named by its line.

| Given | When | Then | Test |
|---|---|---|---|
| A client with a cart and stock on hand | they place the order | a `pending` order, an empty cart, the stock unchanged | `:76` |
| The shelf fell under a cart line | they place the order | 409 `insufficient-stock`, nothing created | `:137` |
| A pending order | the client pays and Stripe sends a signed `payment_intent.succeeded` | the order is `paid` and the stock is down | `:404` |
| An event already applied | Stripe sends it again | 200, nothing moves | `:442` |
| A body changed after Stripe signed it | it reaches the webhook | 400, nothing moves | `:472` |
| A signed success whose amount is not the order's total | it reaches the webhook | the order stays `pending` and a warning is logged | `:553` |
| An order that shipped | the client cancels | 409 `order-not-cancellable` | `:287` |

## Go or no-go: would I ship this to production today?

**No for real money. Yes for a test-mode pilot.**

What holds: CI is green on `main`, with 39 unit suites (681 tests) and 16 end-to-end suites (294
tests) against a real Postgres and Valkey. The webhook signature check is the production code
path in the tests. A rollback was rehearsed on 2026-09-03, about three minutes each way.

What stops it:

- Stripe runs in test mode, and no operation refunds.
- The database is single AZ with one day of backups, "an environment for a review, not a store
  with customers" (`infra/stack.yml:154-155`).
- Nothing measures checkout. The metrics in `ARCHITECTURE.md` do not exist yet.
- The rate limit counter lives in one process (README, "Known gaps").

**Ship criteria:** live Stripe keys and a refund path; Multi-AZ, deletion protection and longer
backups; the four business metrics `ARCHITECTURE.md` names; one friction-log run that reaches M5.
**Owner:** Fernando Ramirez. **Rollback trigger:** after a release, a signed success that does not
turn its order `paid`, or a 5xx from the webhook. Roll back with `ImageTag=<previous sha>`.
**Watch:** paid orders per week, and the `payment.*` and `stock.oversold` log events.

## Now, next and later

- **Now:** run the friction log on the redeployed store. Fix the README where D1 got stuck.
- **Next:** the checkout metrics; split the two causes of `payment.orphan`; a DKIM domain for mail.
- **Later:** live Stripe with refunds; a shared rate-limit counter before a second task; the
  outbox; Multi-AZ.

## Validated by

Planned, results pending. The protocol is `docs/research/friction-log.md`: one developer who has
never seen the repository, the README and Swagger only, timed to the first call and to a paid
order. It has not run. Until it does, D1, the problem and the likelihoods above are assumptions.
