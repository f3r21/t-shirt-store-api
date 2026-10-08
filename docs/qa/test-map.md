# Test map

**The end-to-end suites prove the API's behaviour on a real database and queue. They do not
prove Stripe, SES, S3 or CloudFront, which are stubbed or absent.** A green run means what the
"Proves" column says, and nothing in the "Does not prove" column.

## What the end-to-end suite replaces

`test/app-factory.ts` boots the real application, with its prefix, pipes, guards and filter, on
a real Postgres and a real Valkey. It replaces four things:

| Replaced | By | So a green test does not prove |
|---|---|---|
| Stripe's two network calls | `StripeStub`, which records the calls and keeps the signer | that Stripe accepts the request. The webhook signature is still verified for real, against the same secret |
| The mailer | `MailerSpy`, which records each message | that a message reaches an inbox |
| The object store | an in-memory store | that S3 accepts or serves the file |
| The rate-limit counter | a counter that never blocks, except in `rate-limit.e2e-spec.ts` | the limits, outside that one suite |

## End-to-end suites

| Suite | Proves | Does not prove |
|---|---|---|
| `app` | The `/v1` prefix, helmet headers, the request id, the CORS allow-list, the contract's response headers, 413 and 400 on bad bodies | The CloudFront hop in front, or `TRUST_PROXY_HOPS` in the stack |
| `auth` | Sign-up, sign-in, token checks, refresh rotation with reuse detection under real races, device list, reset and change password, sign-out | That reset mail arrives; that forgot-password takes equal time for known and unknown addresses (it does not) |
| `cart` | The five operations, stock checked on every write, live prices, two concurrent adds both counted, one user's lines only | That the stock is still there at checkout. The cart's check is a courtesy (ADR 22) |
| `catalog-authz` | Every catalog write is 401 anonymous and 403 for a client, and lands for a manager | Authorization outside the catalog, which the other suites cover |
| `catalog-read` | Category filters, the three visibility states, the page ceiling, ids past the `int4` bounds | Speed on a large catalog |
| `checkout` | An order from the cart, the status flow, intents and links, the signed webhook, replays, amount mismatch, restock on cancel, the stock floor at zero | Stripe's real API; the shopper confirming a payment in a browser; CloudFront passing the signature header through |
| `checkout-promo` | Percentage and fixed discounts, the discounted total charged, the four 422 refusals, the last use going to one of two concurrent checkouts | Promo codes on payment links, which do not exist (ADR 37) |
| `deliveries` | The shipped-order queue, the move to `delivered`, who delivered it, who may read it | Assigning an order to a courier, which does not exist (ADR 36) |
| `images` | Upload, a UUID key, one primary under a race, 415 by the file's bytes, 413 above 5 MiB, delete | S3 and CloudFront |
| `likes` | Like and unlike are idempotent, 404 off sale, a user's list only | The low-stock mail, which `stock-notifications` covers |
| `openapi-contract` | The served document declares the contract's 41 operations, status codes, operation ids, security, bodies, required query parameters, headers and bounds, and each failure lists only problem types the contract gives its status | That a live response matches its schema. It compares documents, not responses |
| `openapi-problems` | Each failure lists its own operation's problems: exactly the typed ones at each status of sign-up, a cart add and checkout; the token problems wherever a token is taken; the untyped ones by title and detail; an example at every failure but checkout's 403 | That an operation throws what it lists: each entry is traced to its throw site by reading (ADR 38) |
| `openapi-reset-descriptions` | `forgot-password`, its 202 and `reset-password` carry the contract's text | That the reset mail arrives (risk R10) |
| `order-history` | Own orders only, 404 and not 403 for another client's, the manager's view, five filters, paging | Speed with many orders |
| `promo-codes` | The manager's create, list and update, 401 and 403, codes unique without case, `usedCount` not writable | Their use at checkout, which `checkout-promo` covers |
| `rate-limit` | The real counter: the eleventh sign-in, refresh and sign-up refused, twenty catalog reads let through, 429 with `Retry-After` | Two processes. The counter lives in memory (risk R8) |
| `roles` | 401 before 403, so the token guard runs before the policy guard; a manager-only write refused to a client | Every route. It samples the guard order |
| `stock-notifications` | A job only on a crossing to 3 or below, none on a replay, a stock answer within five seconds with Redis down, the worker's mail, retry and failed set | The SES send; a job lost between commit and enqueue (risk R9) |

## B1 + B2, by acceptance criterion

One row for each criterion in "B1 + B2, as acceptance criteria" in `docs/product.md`. Each test
reads `/docs-json` over HTTP, as a client does, so it compares documents, not responses.

| Suite | Proves | Does not prove |
|---|---|---|
| AC1, `openapi-reset-descriptions` | `forgot-password` and its 202 carry the contract's text | That the text names the next call: the contract's does not. That the API does what the text says, which `auth` covers, and `rate-limit` for the password tier's 429, sent to `reset-password` |
| AC2, `openapi-reset-descriptions` | `reset-password` carries the contract's text | That the reset mail arrives (risk R10) |
| AC3, `openapi-problems` | Checkout lists exactly the four promo-code problems at 422, and `insufficient-stock`, the empty cart and the changed cart at 409, each with its title and an example detail | That checkout throws them: each entry is traced to its throw site in the code (ADR 38) |
| AC4, `openapi-problems` | `POST /promo-codes` lists no `email-taken` at 409 | That an operation without an exact list in `openapi-problems` leaves it out. The contract gives `email-taken` to every 409, so AC5 cannot catch it |
| AC5, `openapi-contract` | Each problem type an operation lists at a status is one the contract gives that status | Titles, details, problems without a type, and a throw site the map leaves out (risk R12) |

### Scenarios by type

Each test is in `openapi-problems.e2e-spec.ts`, unless the row names a criterion.

| Type | Scenario | Test |
|---|---|---|
| Positive | Each reset operation carries the contract's text | AC1, AC2 |
| Positive | Checkout lists its promo-code, stock and cart problems | AC3 |
| Positive | Sign-up lists `email-taken` at 409, with its title and detail | "lists email-taken on the sign-up 409, with its title and detail" |
| Negative | `POST /promo-codes` lists no `email-taken` | AC4 |
| Negative | No public operation, sign-in among them, lists `access-token-expired` | "lists access-token-expired at 401 wherever a token is taken" |
| Negative | A type the contract does not give a status fails the suite | AC5 |
| Boundary | The two reads where the token is optional list `access-token-expired` | "lists access-token-expired at 401 wherever a token is taken" |
| Boundary | A failure with no traced problem shows its status default; only the 403 of `POST /orders`, which no caller reaches, is left bare | "shows the status default where no problem is traced" and "names an example at every failure of every operation" |
| Boundary | The Stripe webhook is the one body with no validation example | "shows a validation 400 wherever a body or a query is validated" |

## Unit suites

They run without a database. Thirteen of them replace Prisma with
`src/prisma/prisma.service.mock.ts`. The argon2 hashing is real, and so is token signing in
`auth.service.spec.ts`.

| Area | Suites | Proves | Does not prove |
|---|---|---|---|
| Auth and users | 5 | Token issue, rotation, reuse detection, session mapping, password rules | That the queries run on Postgres |
| Authorization | 2 | The CASL rules per role, and the guard's 403 | That the ownership condition becomes the right `where` on a real table |
| Catalog, images, likes | 8 | Product, variant and category logic, image type sniffing, the S3 adapter's calls | That S3 accepts them |
| Cart, orders, payments, promo codes | 9 | The status table, prices and totals, discount arithmetic, event handling, the Stripe adapter | Races. Only the end-to-end suites run them |
| Validation and errors | 7 | Every DTO rule, the id and body pipes, problem documents and their titles | The pipe order in the running app |
| Infrastructure | 5 | Every provider resolves, the environment is validated, the request id and log redaction, mail TLS settings, database TLS, pool size | That the mail provider or the database accepts the settings |
| Stock notifications | 3 | The crossing rule, the producer and the worker's processing | Delivery by SES |

## Not covered by any test

- The deploy itself, apart from its own check that the running task is this commit.
- Live Stripe, SES delivery, S3 and CloudFront.
- Load, and races beyond the pairs `Promise.all` sends.
- The integrating developer's experience. One interview, with P3, a front-end developer, ran on
  2026-10-07 (`docs/research/friction-log.md`). Its results are in "Validated by" in
  `docs/product.md`.
- Whether a shopper reads what a front end shows from the API's answers as meant. No interview
  reaches the shopper.
