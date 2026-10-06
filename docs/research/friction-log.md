# API interviews: a developer and a non-developer buy a t-shirt

Two remote interviews on 2026-10-07 test who this API serves. P3, a developer who has never seen
this repository, buys a t-shirt through the API from the README and Swagger UI alone. P4, a
non-developer, buys one through the same API while the moderator plays the storefront the API
does not have. P3 tests the assumption in `docs/product.md` that the second user of this API is
the developer calling it, D1. P4 tests the other half of that section, the shopper who reaches
the API only through D1's software: with the moderator as that software, do the API's answers
carry a shopper's intent to a paid order, and where do its words differ from a shopper's?
Written on 2026-10-06; results pending.

They are two of four interviews that day, one product each: the front app gets P1 and P2. One
person per lens, so every result is a single observation, not a study. This protocol replaces
the single-developer friction log this file held before. The file keeps its name because P3's
session is still a friction log, and links point here.

## Why this shape

- **One developer and one non-developer.** Krug: "If your audience is split between clearly
  defined groups with very divergent interests and needs, then you need to test users from each
  group at least once" (<https://sensible.com/downloads/DMMTchapter09_for_personal_use_only.pdf>,
  pp. 147-148).
- **The first call is the first payoff.** Postman calls time to first call "the most important
  API metric", and says it can be measured "subjectively with usability testing and user
  feedback" (<https://blog.postman.com/the-most-important-api-metric-is-time-to-first-call/>).
- **A friction log records the trip, not a score.** Stripe's developer-platform team had people
  "try to use a new thing and document all the friction along the way"
  (<https://kenneth.io/post/insights-from-building-stripes-developer-platform-and-api-developer-experience>).
  The template has four parts: Context, Pros, Cons, and Stream of consciousness
  (<https://github.com/mikeb-stripe/friction-logging-toolkit>). Google's version colours each
  point green, yellow or red, red being "Places where you would have given up if this wasn't
  your job" (<https://dev.to/thagomizer/friction-logs-3110>).
- **P3's debrief uses three cognitive dimensions.** In Microsoft's API studies, "The results of
  the studies are described in terms of the Cognitive Dimensions framework"
  (<https://www.cl.cam.ac.uk/~afb21/CognitiveDimensions/workshop2005/Clarke_position_paper.pdf>).
- **P4's storefront is a person.** A Wizard of Oz test is one where "a user interacts with an
  interface that appears to be autonomous but is (fully or partially) controlled by a human"
  (<https://www.nngroup.com/articles/wizard-of-oz/>). Here P4 sees the moderator send each
  request, so the wizard is visible and the API's answers are the interface under test.
- **P4's words are checked one at a time,** with NN/g's content-test question, "What does the
  word [X] mean to you?" (<https://www.nngroup.com/articles/testing-content-websites/>).
- **Ease is one question,** the SEQ: "Overall, how difficult or easy was the task to complete?",
  1 to 7 (<https://measuringu.com/seq10/>).

## Setup

- **Target.** The deployed store at `https://d1hfx5i8kcs8ag.cloudfront.net/v1`, with Swagger UI
  at `https://d1hfx5i8kcs8ag.cloudfront.net/docs`.
- **Payment.** Both sessions reach `paid` through the payment link (`POST /v1/payment-links`),
  because the cart flow ends at a client secret for Stripe.js, with no page. Stripe hosts the
  page, so the participant pays with the test card `4242 4242 4242 4242`, any future date and
  any CVC, and needs no Stripe account. The order turns `paid` when the
  `checkout.session.completed` event reaches the webhook.
- **Call.** Google Meet in Chrome, not Safari: Safari's voice processing can leave a local
  recorder's microphone track silent. P3 shares the entire screen for the whole run. P4 watches
  the moderator's shared Swagger window, and shares their own screen only to pay.
- **Recording.** Cap 0.6.0 in Studio mode records the entire screen, the microphone and the
  system audio, locally on the moderator's Mac. Wispr Flow Notetaker writes the transcript; it
  starts with the call, because it cannot import a recording later. Files are named by
  P number and kept outside every repository.
- **Consent.** In writing on 2026-10-06, and confirmed on the recording before the task. It
  covers taking part, recording screen and voice with a transcript, and clips of 60 seconds or
  less shown to RAVN evaluators on an unlisted page. Without clip consent, results quote words
  only. Every file and note uses the P number: no name, email or employer, and a frame that shows
  one is cut. The full recordings and transcripts are deleted by 2026-10-23.
- **Order.** P3 before P4, 15 minutes or more apart, so a store problem shows up first with the
  developer, and the stock check between them catches a variant P3 bought.
- **Accounts.** Every account in either session uses a made-up email ending in `@example.com`.

## Dependencies

Check these on 2026-10-06, and the store again before each session, not with a participant
watching.

- **A product to buy.** On 2026-10-06 the deployed store lists 8 products. P4's task needs a size
  M under 30 USD: variant 2 (product 1, 2400 cents) with stock 2 or more, else variant 3
  (product 2, 2600 cents). Both had stock that day, 14 and 4. A fresh store has no product: the
  seed creates roles and categories only in production (`prisma/seed.ts:61-62`), and only a
  manager can create one (README, "Deploy", step 4).
- **Stripe test mode.** The store holds `sk_test_` keys and the webhook endpoint is added in the
  Stripe dashboard for `checkout.session.completed` (README, "Stripe"). Otherwise M5 never
  arrives. A rehearsal payment turns `paid` within 60 seconds of Stripe's thank-you page.
- **Swagger can send requests.** The "Servers" box in `/docs` lists `/v1` first. On 2026-10-06
  it did at 18:39 UTC, after the deploy of PR #27; at 18:26, before that deploy, it listed only
  `http://localhost:3000/v1`, which makes "Try it out" fail with "Failed to fetch". If it lists only
  `localhost` again, that is friction to log for P3, and for P4 the moderator sends the same
  requests from a terminal.
- **A storefront account for P4.** The moderator creates it on 2026-10-06 with `POST /v1/users`
  and signs in with it during P4's session. Its password lives in a password manager, never in a
  file. A second made-up account rehearses P4's session once, end to end.
- **The recording works.** A test call puts both voices in Cap's video and in Wispr's transcript,
  and the microphone track in Cap is not flat.

## P3: the developer's friction log (30 minutes)

P3 gets the repository link, the base URL and this task, pasted in the chat and read aloud. P3
uses the HTTP tool they like and Swagger UI.

```
Buy one t-shirt through the API and get the order to "paid". Use the README and Swagger. Think aloud.
Repository: https://github.com/f3r21/t-shirt-store-api
Base URL: https://d1hfx5i8kcs8ag.cloudfront.net/v1
```

**Timing.** Minutes 0 to 2: consent and the task. Then the run, with a hard stop at 23:00 on the
run clock, which starts when P3 finishes reading. The last 5 minutes: the debrief.

| # | Milestone | Reached when | Clock |
|---|---|---|---|
| M1 | First successful call | Any 2xx, for example `GET /v1/products` without signing in | time to first call |
| M2 | Signed in | `POST /v1/users` 201, then `POST /v1/auth/sessions` 201 with an `accessToken` | |
| M3 | A variant chosen | P3 holds a `variantId` with stock, from `GET /v1/products/{id}` | |
| M4 | Payment link | `POST /v1/payment-links` 201 with a Stripe `url` | |
| M5 | Paid | `GET /v1/orders/{id}` shows `"status": "paid"` after paying on Stripe's page | time to paid order |

- **Success:** M5 by 23:00, with no help. **Partial:** M4 by 23:00, but not M5. **Fail:** no M4
  by 23:00.
- **The moderator says three things only:** "What are you thinking?" after 20 seconds of silence;
  "What do you think?" or "What would you do if I weren't here?" to a question; and at 23:00,
  "Let's stop here. That's a result too." No hints and no endpoint names.
- **If the store stays down for 3 minutes,** the run clock stops, the outage is logged as the
  store's, and the session is rescheduled.

**Expected friction,** from a dry run on 2026-10-06. Each is logged when it starts and ends, and
never announced:

- Swagger "Try it out" fails with "Failed to fetch" while "Servers" lists only `localhost`.
- Two checkout flows. The cart flow ends at a client secret for Stripe.js; the payment link opens
  Stripe's page.
- Stripe's page may open in the local currency before USD.
- Stripe's thank-you page has no way back to the store.
- The access token lasts 15 minutes, then a call answers 401 `access-token-expired`.
- This file names the route. If P3 opens it, the time is logged and P3 carries on.

**Debrief.** The SEQ. Then one question for each cognitive dimension:

- Domain correspondence: "Did products, variants and payment links match how you think about a
  shop?"
- Penetrability: "When you were stuck, how did you find the way?"
- Progressive evaluation: "How soon could you try something and see if it worked?"

Last, for the context: years of backend experience, and whether P3 has used Stripe before.

## P4: the non-developer shops through the API (25 minutes)

The shop has no website, so the moderator is the website. P4 says what they want in plain
words. The moderator sends the matching request from a request map fixed on 2026-10-06, shows
the exact answer in Swagger UI (or a terminal, see "Dependencies"), and never explains it. P4
pays on Stripe's test-mode page, on their own screen, with a test card the moderator pastes in
the chat.

```
A friend's birthday is on Friday. Buy them a t-shirt in size M for under 30 US dollars. Pay in US dollars.
```

The card says "Pay in US dollars" because the webhook marks an order paid only when the payment
is in USD (`src/payments/payments.service.ts:335`), and Stripe's page may offer the local
currency first. No test has paid in another currency.

**Timing.** Minutes 0 to 3: consent, the framing and the card. 3 to 15: shopping and paying. 15
to 18: the word check. 18 to 22: the debrief. 22 to 25: close.

| Step | When P4 | The moderator sends |
|---|---|---|
| R1 | Asks to see the shirts | `GET /v1/products` |
| R2 | Asks about one shirt or a size | `GET /v1/products/{id}` |
| R3 | First says they want to buy | asks "What would you expect to give the shop here?", then `POST /v1/auth/sessions` with the storefront account, off screen |
| R4 | Asks to pay | `POST /v1/payment-links` with the variant P4 chose |
| R5 | Pays | nothing: P4 shares their screen on Stripe's page |
| R6 | Asks whether it worked, or 30 seconds pass after paying | `GET /v1/orders/{id}` |

A wish no operation serves (changing the size, a return or a refund, a discount code, two
different shirts in one payment, a delivery address, a filter by size or price) gets "The shop
has no answer for that." and is logged as a capability gap. Buying as a guest gets "The shop asks
you to sign in.", and is logged too.

- **Success:** `GET /v1/orders/{id}` shows `"status": "paid"` for a size M shirt under 30 USD,
  paid in USD, with no help beyond the allowed lines. **Partial:** paid, but with help (the
  currency reminder counts), in the wrong size, or over 30 USD. **Fail:** no paid order by minute
  15.
- **Time:** from the end of reading the card to `paid` on screen. It includes the moderator's
  time sending requests, and is labelled wizard time.
- **The moderator says only:** "Here is the shop's answer." after each request; "The shop has no
  answer for that."; the sign-in lines of R3; "What are you thinking?" after 10 seconds of
  silence; "What do you think?" when asked what an answer means; and "Please check the task card
  again." only when P4 is about to pay in another currency, logged as help. The moderator never
  reads the JSON aloud, points at a field, converts cents, or says "paid" before P4 does.

**Probes,** each asked once, when its answer is on screen:

| After | Probe | Correct answer |
|---|---|---|
| R1 | "How much is this one?" | the price in dollars, such as 24 for `2400` (cents of USD) |
| R2 | "Is M available?" | matches `variants[]`: size M with stock 1 or more |
| R6 | "Did it work? How do you know?" | yes, because the status says `paid` |

**Word check.** One word at a time: "What does this word mean to you?"

| Word | What it means in the API |
|---|---|
| variant | one size and colour of a product, with its own price and stock |
| stock | the units on hand for that variant |
| priceFrom | the lowest price among the product's variants, in cents of USD |
| pending | the order exists but is not paid yet; every order starts there |
| payment link | Stripe's hosted page that pays for one variant |

Probes and words score correct, partial (right with doubt, or a guess) or wrong.

**Debrief.** The SEQ, about the purchase. Then "If you ran this shop, what would worry you?" With
2 minutes or more left, P4 picks the five words that best describe shopping this way from a list
of 25, and says why they picked the first.

**If the store fails.** Two 5xx answers or timeouts in a row before the payment switch P4 to a
fallback: a README tour, three business questions, and six of the API's responses to interpret.
It is reported as the fallback, not as the purchase. If Stripe fails, the order is logged as not
paid, and the probes, the word check and the debrief still run.

## Scoring and reporting

- **Success:** success, partial or fail, as each session defines it.
- **Time:** mm:ss, think-aloud time. P3's is the run clock; P4's includes wizard time.
- **Ease:** the SEQ, 1 (very difficult) to 7 (very easy), asked once, at the stop.
- **Friction colour, P3:** green, fine; yellow, slowed down; red, would have given up outside a
  test.
- **Severity:** 0 to 4, from frequency, impact and persistence
  (<https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/>): 0 not a
  problem, 1 cosmetic, 2 minor, 3 major, 4 catastrophe, fix before release. With one participant
  per lens, frequency is unknown, so a finding names the P numbers it was seen in.
- **Individual values only.** "P3: success, 12:40, SEQ 5". Never an average, a percentage or
  "100%". Under the results, once: "Times are think-aloud times. One participant per lens, so
  each result is a single observation."
- **One clip,** 60 seconds or less with captions, only from a P who agreed to clips. Otherwise one
  quote, with the P number.

## Results

Blank until the sessions on 2026-10-07. Filled from the recordings and the notes after each one.

### Context

| | P3 | P4 |
|---|---|---|
| Swagger "Servers" at the start: `/v1` or `localhost` | | |
| Years of backend experience | | n/a |
| Used Stripe before: yes / no | | n/a |
| Clips agreed: yes / no | | |
| Fallback used: no / store / Stripe | n/a | |

### Outcome

| | P3 | P4 |
|---|---|---|
| Task | one t-shirt to `paid` | a size M under 30 USD, paid in USD |
| Success, partial or fail | | |
| SEQ, 1 to 7 | | |
| The quote that best explains the biggest stall or mismatch (mm:ss) | | |

### Milestones

P3 on the run clock. P4 in wizard time; M1 and M2 are the moderator's calls.

| # | Milestone | P3 | P4 |
|---|---|---|---|
| M1 | First successful call | | n/a |
| M2 | Signed in | | n/a |
| M3 | A variant chosen | | |
| M4 | Payment link | | |
| M5 | Paid | | |

### P3's stream of consciousness

| mm:ss | What P3 did or said | Where (README section, Swagger operation, response) | Green, yellow or red |
|---|---|---|---|
| | | | |

### P4's words

| Probe or word | P4's words | Correct, partial or wrong |
|---|---|---|
| "How much is this one?" | | |
| "Is M available?" | | |
| "Did it work? How do you know?" | | |
| variant | | |
| stock | | |
| priceFrom | | |
| pending | | |
| payment link | | |

### P4's capability gaps

| mm:ss | What P4 asked for | The shop's answer |
|---|---|---|
| | | |

### Debrief

| Question | P3 | P4 |
|---|---|---|
| Domain correspondence | | n/a |
| Penetrability | | n/a |
| Progressive evaluation | | n/a |
| What P4 expected to give at sign-in | n/a | |
| Currency picked on Stripe's page, and any pause | | |
| Asked about the order unprompted: yes / no | n/a | |
| "If you ran this shop, what would worry you?" | n/a | |
| Five words, and why the first | n/a | |

### Pros and cons

| | P3 | P4 |
|---|---|---|
| Pros | | |
| Cons | | |

## Findings

| # | Friction, mismatch or capability gap | P3 (mm:ss, minutes lost) | P4 (mm:ss) | Severity 0-4 | Fix belongs in (README, contract, error body, code) |
|---|---|---|---|---|---|
| F1 | | | | | |

### What changes because of this

- In `docs/product.md`: whether D1 stays the user these documents serve (P3), what a front end
  has to translate for the shopper (P4), and the "Now, next and later" list.
- In `docs/qa/risk-register.md`: any new risk, from R10 onward.
- In the README: the line each finding says was missing.
