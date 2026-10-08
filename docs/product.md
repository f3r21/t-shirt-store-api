# Product

**Call: not ready for real money today. Ready for a Stripe test-mode pilot.**
The evidence is in "Go or no-go" below. Written on 2026-10-06, after the build, from sources
dated in this repository. Updated 2026-10-07 with the P3 interview. One interview is an
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

**B1 + B2** is the change P3's interview led to: Swagger UI says what happens after
`forgot-password` (B1) and lists each operation's specific errors (B2). It serves two job stories
from that interview, in paraphrase:

- **B2:** when I integrate an endpoint another team built, I want a written agreement of what to
  send and which specific errors come back, so I can show the user the right message without
  asking that team.
- **B1:** when an operation starts something that goes on elsewhere, like a reset mail, I want the
  docs to say what happens next and which call follows, so I can keep working without asking
  another team.

## The problem

Developers who build an online store struggle to tell what the shopper should see when an API
call fails, and, if it was a payment, whether the shopper was charged. This leads to wrong
messages, and to orders that do not match the charge.

**Verdict on the problem: complicated.** P3's story is one instance of the first half: an API
answered with a status the code did not expect, and the app showed the user the wrong message. The
story mentioned no payment, and P3 did not link it to this statement. In P3's view, the cause
is the contract with the backend team and vague errors. The second half, whether the shopper was
charged, is untested. P3 named a failed payment only as a case for the right message; nobody
spoke to the charge, and nobody tried a payment. This is an anecdote from one participant, not a
pattern, so the statement stays as written.

**The problem B1 + B2 solves.** A front-end developer who integrates this API from Swagger UI
alone cannot tell what happens after `forgot-password`, or which specific errors an operation
returns. So the developer asks the backend team, or shows the user the wrong message when a call
fails.

**North Star: paid orders per week.** Each one is a row in `order_status_history` with status
`paid`, and only the signed Stripe webhook writes that status (ADR 24). No dashboard counts it
yet: `ARCHITECTURE.md` says "None of these exists yet".

**Supporting signal that B1 + B2 moves:** the questions a first-time integrator answers from
Swagger UI alone, without asking the backend team. The blind check in "Go or no-go" counts them.

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

### The interview's candidates, scored

P3's interview gave four candidates. Each one is scored with the course's method: RICE, MoSCoW,
Value vs Effort and the North Star check.

| Candidate | Reach | Impact | Confidence | Effort | RICE | MoSCoW | Value vs Effort | North Star |
|---|---|---|---|---|---|---|---|---|
| B2. Each operation's specific errors in Swagger UI | 8 | 2 | 50% | 0.1 | 80 | Should | Quick win | Moves it: these errors sit on the path to a paid order |
| B1. The reset flow described in Swagger UI | 5 | 1 | 50% | 0.05 | 50 | Should | Quick win | Indirect: reset is not on that path, so it moves the supporting signal |
| B3. All 41 contract descriptions in Swagger UI | 8 | 1 | 50% | 0.1 | 40 | Could | Quick win | Partly: the checkout and payment descriptions |
| B4. Postman: a README line, or a collection | 3 | 0.5 | 50% | 0.05 or 0.1 | 15 or less | Won't | Do last | Moves nothing |
| **B1 + B2, as one capability** | 8 | 2 | 50% | 0.15 | **53.3** | Should | Quick win | Moves it, through B2 |

RICE = (Reach × Impact × Confidence) ÷ Effort. The formula, the impact scale (3 massive, 2 high,
1 medium, 0.5 low, 0.25 minimal) and the confidence steps (100, 80 or 50%) are the course's.
Confidence is 50%, the low step, in every row: one interview, P3 only, is low data. Reach and
Effort are estimates in the course's units, never measured. Reach is how many of 10 integrators
meet the case in a week. Effort is in person-weeks: 0.05 is about 2 hours, 0.1 is half a day. The
step each row takes on the impact scale is a judgment too. The course has no rule to score two
candidates as one, so the bundle takes the larger Reach, the larger Impact and the sum of the
Efforts. Value is Reach × Impact, high at 5 or more; effort is high only above a day.

**Why B1 + B2, and not B2 alone.** B1 adds effort and no reach or impact, so the bundle scores
53.3, below B2's 80. The score informs the call; it does not make it. B1 is the one finding seen
in what P3 did: the reset flow stopped P3, who asked four times what came next (spec #34). B2
rests on what P3 said a backend team should give, backed by P3's story and the clear 409.
Together they let Swagger UI alone say what happens next and what can go wrong. B3 holds B1's
text but goes wider than what stopped P3.

## Risks

Likelihood and impact are judged on a 1 to 3 scale, not measured.

| Risk | L | I | L × I | What limits it |
|---|---|---|---|---|
| D1 cannot reach a paid order alone: a fresh store has no product, and the API cannot create a manager | 3 | 3 | 9 | "Before the session" in `docs/research/friction-log.md`; README "Deploy", step 4 |
| A shopper pays for a unit that is gone. A pending order holds no stock, so two orders can pay for the last unit; the stock floors at zero and logs `stock.oversold` | 2 | 3 | 6 | The intent checks stock before Stripe is asked. A refund is done by hand in Stripe |
| Mail does not arrive. SES is in its sandbox and the mail lands in spam (README, "Known gaps") | 3 | 2 | 6 | A domain with DKIM |

For B1 + B2:

| Risk | L | I | L × I | What limits it |
|---|---|---|---|---|
| The reset flow still dead-ends in the demo: its mail is not delivered (SES sandbox), so a tester never gets the token for `reset-password` | 3 | 2 | 6 | A line in the README's "Known limitations" says so |
| The bet is wrong: it rests on one participant, and P3 is not at ease in Swagger UI, so integrators may look elsewhere | 2 | 2 | 4 | The blind check before and after shows whether Swagger UI alone answers the questions |
| Swagger UI lists a problem an operation cannot return, or misses one it can | 2 | 2 | 4 | Each entry is traced to its throw site, and an end to end test fails on a type the contract does not allow for that status |

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

## B1 + B2: what it must do

- **Functional, B1:** `forgot-password` and `reset-password` carry the contract's own description
  in Swagger UI: the 202 for any address, the mail with the reset token only for a known one,
  the token in the body of `reset-password`, and when 422 and 429 come back.
- **Functional, B2:** for each operation, each error status lists the specific problems that
  operation can return, and only those. Each one shows its type when it has one, its title and an
  example detail.
- **Non-functional:** 175 of the 176 error statuses of the 41 operations have at least one named
  example, and 0 of them show a problem type the contract does not allow for that status. The one
  left bare is the 403 of `POST /orders`, which no caller can reach today (ADR 38). The end to end
  suite checks every operation.

## B1 + B2, as acceptance criteria

Each row is one criterion of spec #34. The Test column names each test by its file in `test/`
and its title.

| # | Given | When | Then | Test |
|---|---|---|---|---|
| AC1 | The served document | a reader opens `POST /auth/forgot-password` | its description and the description of its 202 are the contract's: 202 always, a mail only for an address with an account, 429 on too many requests | `openapi-reset-descriptions.e2e-spec.ts`, "gives forgot-password and its 202 the contract description" |
| AC2 | The served document | a reader opens `POST /auth/reset-password` | its description is the contract's: the token in the body, 422 for an unknown or expired token, and on success every device signed out and a mail sent | `openapi-reset-descriptions.e2e-spec.ts`, "gives reset-password the contract description" |
| AC3 | `POST /orders` in the served document | a reader opens its 422 and 409 | the 422 lists exactly the four promo-code problems. The 409 lists `insufficient-stock`, the empty cart and the changed cart. Each shows its title and an example detail | `openapi-problems.e2e-spec.ts`, "lists the four promo-code problems on the checkout 422"; "lists insufficient-stock on the checkout 409"; "lists the empty and changed cart conflicts on the checkout 409" |
| AC4 | `POST /promo-codes` in the served document | a reader opens its 409 | `email-taken` is not listed | `openapi-problems.e2e-spec.ts`, "lists no email-taken on the promo-code 409" |
| AC5 | The served document and the contract | the end to end suite runs | each problem type an operation lists at a status is one the contract lists for that status, or the test fails | `openapi-contract.e2e-spec.ts`, "lists only problem types the contract gives each status" |

The contract's `forgot-password` text names no next call, so AC1 leaves out the spec's
"reset-password next" clause. The next step is on `reset-password`, which asks for the token from the
reset mail (AC2).

## Go or no-go: would I ship this to production today?

**No for real money. Yes for a test-mode pilot.**

What holds: CI is green on `main`. On the branch of spec #34, a local run on 2026-10-07 passes
39 unit suites (681 tests) and 18 end-to-end suites (333 tests) against a real Postgres and
Valkey. The webhook signature check is the production code path in the tests. A rollback was
rehearsed on 2026-09-03, about three minutes each way.

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

### B1 + B2: go, in one deploy

**Success measure: a blind check, before and after.** A first-time integrator answers three
questions from the README on GitHub and the deployed Swagger UI alone. What happens after
`forgot-password`, and which call comes next? Which specific errors can `POST /orders` return,
and what is the title for too little stock? Can "Email already registered" come back from
`POST /promo-codes`? The check runs once before any deploy, on the deployment of image
`d442968` (deployed on 2026-10-06), and again once the change is deployed. It passes when all
three are answered correctly from the page, with no guess. This is a rehearsal by an agent, not
a user. The contract's `forgot-password` text names no next call, so the check after may still
read "which call comes next" as an inference. One contract sentence would close that.

- **Recommendation:** go. It changes the served document and the text of the docs and the
  README; the contract and what the API answers stay the same.
- **Ship criteria:** all of B1 + B2 green in Verify, Image and Prose, reviewed, in one deploy.
- **Owner:** Fernando Ramirez.
- **Rollback trigger:** the live `/docs-json` lists a problem type the contract does not allow for
  its status.
- **Watch:** the blind check, before and after; then paid orders per week. Before, on
  2026-10-07, a rehearsal by an agent, not a user: none of the three questions was answered from
  the page alone. The next call after `forgot-password` and the promo-code answer were guesses,
  and for `POST /orders` the page gave the statuses but not the title for too little stock
  (`docs/research/friction-log.md`). After: once the change is deployed.

## Now, next and later

- **Now:** B1 + B2, from P3's interview: Swagger UI says what happens after `forgot-password` and
  lists each operation's specific errors. P3's remark on Swagger UI is a preference, recorded in
  `docs/research/friction-log.md`, not scheduled.
- **Next:** R1's condition to fall, a developer reaching a paid order without help on a store that
  holds a product and a manager (`docs/qa/risk-register.md`); the checkout metrics; split the two
  causes of `payment.orphan`; a DKIM domain for mail.
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
more developers, D1 and the problem stay assumptions. What the interview changes is in
[What changes because of this](research/friction-log.md#what-changes-because-of-this).
