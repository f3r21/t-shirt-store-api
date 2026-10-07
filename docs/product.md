# Product

**Call: not ready for real money today. Ready for a Stripe test-mode pilot.**
The evidence is in "Go or no-go" below. Written on 2026-10-06, after the build, from sources
dated in this repository. One developer, P3, was interviewed on 2026-10-07. One interview is an
anecdote, not a pattern, so the user and the problem are still assumptions.

## Who it is for (assumption)

**D1, the developer who integrates the store.** D1 builds the shop front or the mobile app that
calls this API. D1 reads the contract and Swagger UI, not the code, and decides what the shopper
sees from the status code and the problem type. D1 was rebuilt, before any interview, from
reasoning written while the API was built:

| What D1 needs | Where it was written, and when |
|---|---|
| To tell an expired token from a wrong password, or the app "loops between refreshing and the sign-in screen" | ADR 5, 2026-08-28 |
| One value to branch on: "A client branches on this value and on nothing else" | `contract/openapi.yaml:2083`, 2026-08-28 (`43b7995`) |
| To tell three 409 answers apart "to show the right message" | `contract/openapi.yaml:2099`, 2026-08-28 |
| To know which rule refused a promo code: "a client retypes an unknown code and removes an expired one" | `contract/openapi.yaml:2105`, 2026-09-04 (`3864713`) |
| Their own origin allowed: "a deployment with a front end names it" | ADR 19, 2026-09-01 |

The brief's users, the manager, the client and the delivery person, reach the API only through
D1's software. So D1 is the user these documents serve.

One developer, P3, tested this assumption on 2026-10-07. P3 told a story from past work, heard
the problem statement below read aloud, and then tried this API, starting from Swagger UI. P3 did
not ask for the README. The protocol is `docs/research/friction-log.md`.

**Verdict on D1: complicated.** P3 is a front-end developer. In P3's story, the team's front-end
code decided what the user saw from the status code, as D1 does. But P3 read the code and Chrome
DevTools, not a contract, and asks for a written agreement with the backend team. This is an
anecdote from one participant, not a pattern, so D1 stays an assumption.

## The problem

Developers who build an online store struggle to tell what the shopper should see when an API
call fails, and, if it was a payment, whether the shopper was charged. This leads to wrong
messages, and to orders that do not match the charge.

**Verdict on the problem: complicated.** P3's story is one instance of the first half: an API
answered with a status the code did not expect, and the app showed the user the wrong message. The
story mentioned no payment, and P3 did not link it to this statement. In P3's view, the cause
is the contract with the backend team and vague errors. The second half, whether the shopper was
charged, is untested: nobody spoke to it, and nobody tried a payment. This is an anecdote from
one participant, not a pattern, so the statement stays as written.

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
numbers is a guessed decision. The interview with P3 measured neither. When RICE ranks the "Next"
list, what P3 said informs each item's confidence, capped at 70%.

## Three risks

Likelihood and impact are judged on a 1 to 3 scale, not measured.

| Risk | L | I | L × I | What limits it |
|---|---|---|---|---|
| D1 cannot reach a paid order alone: a fresh store has no product, and the API cannot create a manager | 3 | 3 | 9 | "Before the session" in `docs/research/friction-log.md`; README "Deploy", step 4 |
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

What holds: CI is green on `main`, with 39 unit suites (681 tests) and 16 end-to-end suites (296
tests) against a real Postgres and Valkey. The webhook signature check is the production code
path in the tests. A rollback was rehearsed on 2026-09-03, about three minutes each way.

What stops it:

- Stripe runs in test mode, and no operation refunds.
- The database is single AZ with one day of backups, "an environment for a review, not a store
  with customers" (`infra/stack.yml:154-155`).
- Nothing measures checkout. The metrics in `ARCHITECTURE.md` do not exist yet.
- The rate limit counter lives in one process (README, "Known gaps").

**Ship criteria:** live Stripe keys and a refund path; Multi-AZ, deletion protection and longer
backups; the four business metrics `ARCHITECTURE.md` names; the API interviews, with their
verdicts on D1, the problem and the product written into this page, and every feedback weighed as
a core problem fixed.
**Owner:** Fernando Ramirez. **Rollback trigger:** after a release, a signed success that does not
turn its order `paid`, or a 5xx from the webhook. Roll back with `ImageTag=<previous sha>`.
**Watch:** paid orders per week, and the `payment.*` and `stock.oversold` log events.

## Now, next and later

- **Now:** weigh the feedback from P3's interview. Each feedback weighed as a core problem becomes
  a "Next" item, not code; one that names a missing README line is fixed in the README instead. A
  preference is recorded in `docs/research/friction-log.md`, not scheduled. So far, the password
  reset description is a "Next" item, and P3's remark on Swagger UI is a preference.
- **Next:** R1's condition to fall, a developer reaching a paid order without help on a store that
  holds a product and a manager (`docs/qa/risk-register.md`); the checkout metrics; split the two
  causes of `payment.orphan`; a DKIM domain for mail; a Swagger UI description for
  `forgot-password` that names the mail it sends and the `reset-password` call that follows (P3,
  an anecdote).
- **Later:** live Stripe with refunds; a shared rate-limit counter before a second task; the
  outbox; Multi-AZ.

## Validated by

One interview so far, on 2026-10-07, with P3, a front-end developer. The protocol is
`docs/research/friction-log.md`. P3 told a story from past work, heard the problem statement read
aloud, and then tried this API, starting from Swagger UI, without asking for the README. The
verdicts:

- **D1:** complicated (see "Who it is for").
- **The problem:** complicated (see "The problem").
- **The product:** unclear. One error was clear: the 409 for an email already registered, read
  from its problem title. The password reset flow was unclear from Swagger UI alone. Payment is
  untested, because P3 did not sign in or place an order.

Each verdict is an anecdote from one participant, not a pattern. Until the pattern repeats with
more developers, D1 and the problem stay assumptions.
