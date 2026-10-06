# Risk register

**The top risk is not a bug: a developer cannot reach a paid order on a fresh store without an
operator's help. Two more score 6, an oversold unit and mail that never arrives.** Each has a
mitigation and none is closed. Probability (P) and impact (I) are judged on a 1 to 3 scale, not
measured. The score is P × I, out of 9. Reviewed on 2026-10-06.

| # | Risk | P | I | P × I | Mitigation in place | How it is tested | Known limitation |
|---|---|---|---|---|---|---|---|
| R1 | A developer cannot reach a paid order on a fresh store: the seed creates no product, and the API cannot create a manager | 3 | 3 | 9 | An operator promotes a manager with `SEED_MANAGER_EMAIL` and creates one product with stock (README, "Deploy", step 4) | Not yet: the friction log is planned | `prisma/seed.ts:61-62` |
| R2 | A shopper pays for a unit that is gone: a pending order holds no stock, so two orders can pay for the last one | 2 | 3 | 6 | The intent and the link check stock before Stripe is asked; the webhook floors the stock at zero and logs `stock.oversold` | `checkout.e2e-spec.ts`: "refuses an intent when a line is above the stock", "floors the stock at zero when the units are gone" | No refund operation exists, so a person settles it in the Stripe dashboard |
| R3 | Reset and low-stock mails never reach the inbox: SES is in its sandbox, production access was denied, and the mail lands in spam | 3 | 2 | 6 | A failed send never fails the request; Mailpit shows every message locally | `mailer.nodemailer.spec.ts`; the end-to-end suites assert on a spy, not an inbox | Only a domain with DKIM fixes the spam (README, "Known gaps") |
| R4 | A `payment.orphan` warning cannot be acted on: an expected link sale and a lost order log the same line | 2 | 2 | 4 | The webhook answers 200, so Stripe stops retrying, and the line carries the event id | `checkout.e2e-spec.ts`: "answers 200 for an event that names no order, and records it" | Three unexpected ones were logged on 2026-09-07 (README, "Known gaps") |
| R5 | A Stripe change breaks payments while every test stays green, because the tests stub Stripe's network calls | 2 | 2 | 4 | The SDK version is locked in `package-lock.json`; the signature check runs for real | `stripe.gateway.spec.ts`, and `checkout.e2e-spec.ts` with the stub | Only a test-mode payment by hand, such as the friction log, reaches Stripe |
| R6 | A rolling deploy breaks on a migration the previous image cannot read | 1 | 3 | 3 | Migrations are additive by rule and run before the roll; rollback by image tag, rehearsed at about three minutes each way | CI fails when the migrations and the schema disagree (`check:db`) | The liveness route reaches no database, and two of the eleven migrations are not additive (README, "Known gaps") |
| R7 | Data is lost: one database, single AZ, one day of backups, deleted with the stack | 1 | 3 | 3 | Only the daily backup: the stack is built for a review | Not tested | `infra/stack.yml:154-174` |
| R8 | The rate limit stops working once a second task runs, because the counter lives in process memory | 1 | 2 | 2 | The stack allows one task: `DesiredCount` has a maximum of 1 in `infra/stack.yml` | `rate-limit.e2e-spec.ts`, against one process | "Correct for one instance, wrong for two" (README, "Known gaps") |
| R9 | A low-stock mail is lost when the process dies between the commit and the enqueue | 1 | 1 | 1 | The enqueue waits for the commit, so a mail outage cannot fail a paid order | `stock-notifications.e2e-spec.ts`, Redis unreachable included | The fix not built is a transactional outbox (`ARCHITECTURE.md`) |

## What would change a score

- R1 falls to P 1 once the store holds a product and a manager, and the friction log confirms it.
- R2 rises to P 3 if a launch sells limited stock. Holding stock at order time would lower it.
- R3 falls to P 1 with a verified domain and SES production access.
- R8 rises to P 3 the day the template allows a second task. A shared counter in Valkey closes it.
- The friction log may add risks for the integrating developer. They go here as R10 onward.
