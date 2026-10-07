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

## End-to-end suites (16 suites, 296 tests)

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
| `openapi-contract` | The served document declares the contract's 41 operations, status codes, operation ids, security, bodies, parameters, headers and bounds | That a live response matches its schema. It compares documents, not responses |
| `order-history` | Own orders only, 404 and not 403 for another client's, the manager's view, five filters, paging | Speed with many orders |
| `promo-codes` | The manager's create, list and update, 401 and 403, codes unique without case, `usedCount` not writable | Their use at checkout, which `checkout-promo` covers |
| `rate-limit` | The real counter: the eleventh sign-in, refresh and sign-up refused, twenty catalog reads let through, 429 with `Retry-After` | Two processes. The counter lives in memory (risk R8) |
| `roles` | 401 before 403, so the token guard runs before the policy guard; a manager-only write refused to a client | Every route. It samples the guard order |
| `stock-notifications` | A job only on a crossing to 3 or below, none on a replay, a stock answer within five seconds with Redis down, the worker's mail, retry and failed set | The SES send; a job lost between commit and enqueue (risk R9) |

## Unit suites (39 suites, 681 tests)

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
- The integrating developer's experience. One interview, with P3, a developer, ran on
  2026-10-07 (`docs/research/friction-log.md`). Its results are in "Validated by" in
  `docs/product.md`.
- Whether a shopper reads what a front end shows from the API's answers as meant. No interview
  reaches the shopper.
