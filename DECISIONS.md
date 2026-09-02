# Decisions

Choices this implementation makes that the contract and the brief leave open, or that it
makes against common practice. Each entry states what was chosen, what it costs, and what
was given up. The design ledgers for the ERD and the contract live in the other repository,
at `4-database/3-erd/DECISIONS.md` and `5-api-design/DECISIONS.md`. This file covers the
code.

## 1. The refresh token is opaque, and its hash is not argon2

The refresh token is 32 random bytes in hex. The reset token is generated the same way.
Both are stored as `HMAC-SHA-256(token, REFRESH_TOKEN_PEPPER)` and never as argon2id, while
passwords stay on argon2id.

**Why not argon2 for the tokens.** The reason is structural, not a preference about speed.
Both tokens are found *by* their hash: `refresh_tokens.token_hash` carries a unique index,
and the reset request body carries only the token and the new password, so there is no
second key to find the row by. argon2 draws a fresh salt on every call, so its digest is not
a function of its input and the `where` clause could never match. Measured on this machine,
argon2 also costs about 40 ms per call against 0.005 ms for the fast hash, on an endpoint
reachable without a token.

**Why argon2 stays for passwords.** A password is short, human-chosen, reused across sites,
and verified against a row the server has already located by email. Cost per guess and a
per-row salt are the whole defence. A refresh token is 256 bits from a CSPRNG, single use
and short-lived, so there is no dictionary to slow down and nothing to amortise across rows.

**Why a pepper rather than a bare SHA-256.** An attacker holding a read-only copy of the
database cannot turn a stored hash into a token the server will accept. **Cost:** a second
secret to manage, and rotating it invalidates every stored token at once, which signs
everyone out. **Given up:** at 256 bits of input entropy the pepper buys less than it would
for a low-entropy secret, so this is a small margin bought with real operational weight.
`JWT_SECRET` is deliberately not reused, because rotating the signing key would otherwise
invalidate every stored hash at the same moment.

## 2. A device is a family of refresh tokens, with a grace window over rotation

`refreshSession` rotates with a single `updateManyAndReturn` whose `where` carries the
token hash, the expiry and the absolute cap. PostgreSQL re-evaluates a `WHERE` clause after
waiting on a concurrent writer, so exactly one of two racing requests can match a given
hash. A read followed by a write would let both pass.

**That is correct and it was only half the story.** The loser of the race held a token whose
hash was now on record as spent, so it went to reuse detection, and the contract's answer to
reuse is to delete every refresh row for that user. Two honest browser tabs refreshing in the
same moment signed the account out of every device, with no attacker anywhere. It reproduced
on the first attempt with two concurrent refreshes of one token, as `200 401` and zero rows
left.

**This entry once defended keeping it, and the defence did not survive its own repository.**
The argument was that the contract states the behaviour literally. Item 7 of this file amended
the contract when the code and the document disagreed about a 429, under the heading "The
contract was amended rather than the guard weakened". A rule applied in one entry and not the
other is not a rule. The position was also at one end of the industry range: Okta ships a 30
second grace period configurable from 0 to 60, Supabase ships 10 seconds, and where Auth0
revokes a token family and Supabase and Keycloak revoke a session, this revoked the account.

**The first fix was wrong, and a review found it an hour after it shipped.** It kept one row
per device and, on the grace path, rotated that row for the loser and wrote the winner's
**live, never used** token into `previous_token_hash`. The winner refreshes when its access
token expires, fifteen minutes later, long after a ten second window has closed: its token
matches no live hash, the grace branch declines, and reuse detection finds it and deletes
every session for the user. The two-tab bug had not gone away. It had moved a quarter of an
hour into the future, where nobody would connect it to two tabs.

**Both tests written for that fix refreshed again immediately, so both ran inside the
window.** A test written by the author of a fix inherits the author's picture of it. That is
the failure the block brief names at line 330, and it is the second time this repository has
produced it, after a test that derived its boundary from the constant it was checking.

**What it does now: a device is a family of rows, not a row.** One row could not hold two live
tokens, and two live tokens are exactly what two tabs need. `refresh_tokens.family_id` names
the session by the id of the row that founded it, and the founder carries null, so no insert
has to reference its own id and the migration needed no backfill.
`consumed_refresh_tokens` records every hash the server has spent, with the moment it was
spent.

Rotation asks three questions, in order:

1. **Is this the live token?** One conditional write, and the spent hash is recorded in the
   same transaction. Not tidiness: as two statements a losing racer lands between them, finds
   no live row and no record yet, and gets a 401. Three concurrent refreshes reproduced that
   as `200 401 200`.
2. **Was it ever spent?** If not, 401 and **nothing is deleted**. The previous version looked
   the hash up in `previous_token_hash` with no liveness filter and no time bound, so a value
   left behind by a session that expired weeks ago ended every live session the user had.
3. **Was it spent inside the window?** If so, an honest racing tab: it gets **a new row in the
   same family**, and the row the winner holds is not touched. If not, theft, and the
   contract's answer is to delete every refresh row for that user.

`consumed_at` is never updated, so the window belongs to the spent token and no amount of
racing extends it. A new row inherits `created_at` from the founder, so the thirty day
absolute cap belongs to the family rather than restarting with every tab.

**What changed outside the rotation.** `listSessions` groups by family, or two tabs would read
as two devices and the user would be offered two things to sign out of that are one thing.
Both session deletes name the family, or ending a session would leave the other tab signed in.
`sid` is the family, which is why the family is an integer named after its founding row: the
contract's promise that the session id does not change survives without touching the type.

**Given up, and it is a real cost.** Inside the window a stolen token is accepted and no alarm
fires, and each acceptance adds a live row to the family. The bound is the window times the
tier on `POST /auth/refresh`, ten rows per spent token at the defaults, and those rows expire on
their own. `REFRESH_GRACE_SECONDS` is an environment variable rather than a constant precisely
because that is the dial, and 0 turns it off. `consumed_refresh_tokens` grows with traffic and
nothing prunes it yet; a sweep of rows older than the absolute cap is safe by construction,
since a token past that cap can rotate nothing, and it is the first thing to add before this
runs anywhere real.

**How the tests avoid proving nothing.** Two sabotages, and they have to be complementary.
Making the window never close turns the reuse test red and leaves the three grace tests green.
Setting the grace to zero turns the three grace tests red and leaves the reuse test green.
**Each measures its own half and neither covers the other**, which is the only way to tell a
working window from one that never closes.

## 3. Reuse detection now recognises every generation, and this entry says why it used to not

**Closed, and closed as a side effect rather than on purpose.** This entry used to record a
declared defect: `previous_token_hash` held the immediately preceding hash and nothing older,
so an attacker who waited through two legitimate rotations before replaying a stolen token
was not caught. The contract at `openapi.yaml:247` grants no carve-out for how old a spent
token is, so the code was knowingly weaker than the document it was written against.

The alternative named here was **"a used-token table with an expiry sweep, which catches every
generation at the cost of a table that grows with traffic"**, and it was rejected as the worse
trade for one Postgres and one store.

**Item 2 built that table for a different reason and this fell out of it.**
`consumed_refresh_tokens` exists because one column cannot say both "still acceptable for a
few seconds" and "spent, raise the alarm", and a table that answers the second question
answers it for every generation, not just the last. A token replayed ten rotations later is
found and ends every session, which is what the contract always said.

**The cost that was rejected is now real and is accepted with its name on it.** The table grows
with traffic, one row per rotation per device, and nothing prunes it yet. The sweep this entry
once used as the reason not to build it is now the work this entry owes: rows older than the
absolute session cap are dead by construction, since a token past that cap can rotate nothing.

**What is worth keeping from the old entry:** rejecting a design for its cost, and then
building the same design later because a different problem forced it, is worth writing down
rather than quietly enjoying. The trade was not re-evaluated. It was overtaken.

## 4. The access token carries a session id

The payload is `{ sub, sid, role }`. `sid` is the device's session, which since item 2 is a
family of refresh rows named after its founding row rather than a single row.

**Why it is not optional.** `DELETE /auth/sessions/current` ends the session of the device
that sent the request, and that request carries an access token and nothing else. Without
the claim the server cannot name it. The contract keeps the session id stable across
rotation, so the claim stays true for the life of the session, and naming a family by its
founding row is what let families arrive without breaking that promise or the claim's type.

**It is also what makes revocation work, and that came later.** `AccessTokenGuard` looks the
`sid` up and refuses a token whose session no longer exists. Before that, a verified signature
was treated as a live session: deleting refresh rows removed a device's ability to renew and
left it able to act for the rest of the access token's fifteen minutes.
`mailer.nodemailer.ts` told the reader "Every device was signed out", which was untrue of the
token already in a thief's hand, and `DELETE /auth/sessions/{id}` had the same hole.

**What that costs, said plainly:** one indexed lookup on every protected request, which is
precisely the cost a stateless token exists to avoid. **It is paid because the alternative is
that signing out does not sign out**, and because the sentence in that mail is read by
somebody who has just decided their account is compromised. If the lookup ever becomes the
bottleneck the answer is a short-lived cache of revoked session ids, not removing the check.

**Why `role` is there.** The contract has no operation that reads the current user, so
nothing else would tell a guard what the caller is. **Cost:** a role change lags by one
access token lifetime. That lag used to be shared with revocation and no longer is, so `role`
is now the only claim in this payload that can be stale.

## 5. No Passport

The access token guard is a plain `CanActivate` over `JwtService`. `@nestjs/passport` and
`passport-jwt` are not installed.

The assigned NestJS authentication chapter builds its entire JWT flow this way and mentions
Passport only as a pointer to a different chapter. The deciding reason is the error shape:
the contract's 401 carries three distinguishable problem types, and a client that cannot
separate `access-token-expired` from `invalid-credentials` loops between refreshing its
token and sending the user back to the sign-in screen. A hand-written guard branches on
`TokenExpiredError` in one line. `AuthGuard('jwt')` throws one generic exception and would
have to be subclassed anyway. **Cost:** roughly forty lines of bearer extraction and error
branching that a library would otherwise own.

## 6. Three authentication states, not two

`@Public()` for the seven operations the contract marks `security: []`, `@OptionalAuth()`
for the two that are spelled with an empty security object beside the bearer scheme, and
the global guard for the remaining twenty-eight.

`@Public()` cannot express the optional case, because it returns before any token work and
leaves the request user unset, so a manager who does send a token would be invisible to the
handler. An optional route tolerates a missing token and still rejects a broken one.

**Cost of binding the guard globally:** every public operation needs a decorator, and a
missing one makes a public route answer 401. That failure is loud and a test catches it,
which is the argument for it: the failure that gets noticed is the safe one.

## 7. Rate limiting is per source address, in three tiers

**Per address, not per account.** Keying the reset throttle on the email address would
answer 429 for a registered address and 202 for an unknown one, which rebuilds exactly the
account enumeration oracle that the unconditional 202 exists to close. It would also require
overriding `getTracker`, and guards run before pipes, so the body is unvalidated at that
point. **Given up:** a distributed attacker spreading requests across addresses is not
slowed by a per-address limit.

**One limit could not be right for both browsing and sign-in.** `ThrottlerGuard` is bound as
an `APP_GUARD` in `app.module.ts` and no `@SkipThrottle` exists anywhere in `src` or `test`, so
all 20 route handlers run behind it. The module default used to be 5 requests per 60 seconds,
which is the number this entry got wrong: it is a plausible sign-in limit and an unusable
browse limit, and it applied to `GET /products` as much as to a password reset. Raising it to
serve browsing would have loosened sign-in by the same factor, which is the operation every
credential-stuffing run targets first.

So there are three tiers, all keyed `default` so the guard emits a plain `Retry-After` rather
than `Retry-After-<name>`. Browsing takes `THROTTLE_LIMIT`, now 100 per 60 seconds. Sign-in
takes `SIGN_IN_THROTTLE`, 10 per 60 seconds, because a person who mistypes a password retries
within seconds and a script does not stop at ten. The three password operations take
`PASSWORD_THROTTLE`, 5 per 900 seconds.

**The contract was amended rather than the guard weakened.** It declared a 429 on
`requestPasswordReset`, `resetPassword` and `changePassword`, and sign-in answered a status the
document did not declare. `createSession` now declares it, and `info.description` states the
tiers once instead of adding a 429 to all 37 operations.

**Only a test proves any of this.** `@Throttle` takes a plain record, so a misspelled key
compiles and is ignored at run time. `test/rate-limit.e2e-spec.ts` runs against the real
counter, which every other suite replaces, and asserts the eleventh sign-in is refused, the
header is unsuffixed, and twenty catalog reads are not.

**In-memory storage.** One process, so the counter is correct. This is the first thing to
change if the service ever runs more than once, and a Lua error from a Redis store would
surface as a 500 on sign-in, which is why it is not being added the day of a checkpoint.

## 8. Sessions expire absolutely, after 30 days

A rotating token could otherwise live forever. `created_at` is never rewritten on rotation,
so the cap needed no column: a rotation is refused when the row is older than
`REFRESH_ABSOLUTE_TTL_DAYS`, and it answers with the same `refresh-token-unknown` 401 that
the contract already admits for an expired token. RFC 10017 (BCP 212, August 2026) makes a
maximum lifetime or an inactivity expiry a MUST, scoped to browser-based applications, so it
is persuasive rather than binding for a headless API.

## 9. The reset token lives for 30 minutes

The contract sets no window. Thirty minutes is long enough to walk to a laptop and short
enough that a link left in an inbox stops working within the hour. Nothing else depends on
the number, so it is a module constant rather than configuration.

## 10. Email is folded to lower case, in full

The column was plain text behind a case-sensitive unique index, so without normalisation
`ana@example.com` and `ana@EXAMPLE.com` registered as two accounts, and three operations look
an address up by equality.

The **whole** address is folded, not only the domain. RFC 5321 leaves the local part
case-sensitive, so this is a product decision rather than a standards one: no mail provider
a customer of this store is likely to use treats `Ana@` and `ana@` as two people, and two
accounts for one person is the worse failure.

**Done in `20260902013632_email_citext`:** the column is `citext`, so the database refuses
a second capitalisation from any writer, and `auth.e2e-spec.ts` proves it with a create that
goes around the service. It is a column type and not the `lower(email)` index this entry
first named, for three reasons. The schema cannot state an expression index, and Prisma's
own documentation says one added by hand is invisible to `db pull`. Since 7.4.0 `migrate dev`
has emitted `DROP INDEX` for hand-written partial indexes it meets in the shadow database
(prisma/prisma#29289, open), and a constraint the tooling may remove on the next migration
is not a durable form. Whether an expression index shares that fate is unverified, and the
CI drift check is not where to find out. `@db.Citext` is a native type, so
`migrate diff --exit-code`, which CI runs, sees the column and nothing to drop: it answers
"No difference detected" after the migration and reports the type change against the
previous schema. The extension is installed by one line in the migration,
`CREATE EXTENSION IF NOT EXISTS citext`, because Prisma manages extensions only behind the
`postgresqlExtensions` preview flag and does not need to here.

The cost is that every comparison on the column is case-insensitive, `ORDER BY` included,
which is right for an address and wrong for almost anything else, so nothing else is
`citext`. The normaliser stays: `citext` does not trim, and one stored form keeps the mailed
address and the three lookups the same string.

## 11. Problem titles come from a table, never from the exception message

`toProblem` reads `err.getResponse()` and falls back to a table transcribed from the
contract's own response examples. It never reads `err.message`, because Nest fills that with
request-derived text: an unrouted request would answer with the title `Cannot GET /v1/nope`,
and a malformed body would echo a fragment of what was posted. RFC 9457 requires a title
that does not change between occurrences. The message is logged instead of returned.

The validation factory emits one entry per rejected **field** rather than one per failed
constraint, because the contract says the member carries one entry per rejected field, and
three entries all named `password` would let a caller count decorators.

## 12. Known gaps, stated rather than hidden

- **`requestPasswordReset` leaks through timing, and `createSession` no longer does.** Both
  answer identically on the two paths and neither used to take the same time on them, and
  the asymmetry in what was done about it is deliberate rather than an oversight.

  Sign-in was closed. `createSession` returned at the null user and skipped the only
  expensive call on the route, so a wrong address answered in about 3 ms against about 35 ms
  for a wrong password, and the gap named which addresses have accounts. It now runs one
  Argon2id hash and discards it, because **the equivalent work already existed**: it is the
  `verify` the other path performs, so closing the gap cost one call. `openapi.yaml:100` also
  promises this one explicitly, in the words "The server does not say which of the two was
  wrong", and a promise in the contract is not a thing to leave half kept.

  The reset request stays open. Its equivalent work is a database write and a message to a
  mail provider, and neither can be faked without writing rows nobody asked for or sleeping
  the process, which are both worse than the leak. Its contract text promises an
  unconditional 202 and says nothing about time. It is rate limited, at 5 per 900 seconds,
  which slows enumeration without closing it. **Said plainly rather than left as an
  inconsistency for a reviewer to find.**
- **A failed mail send does not fail the request.** Both mailing operations change a
  password first and mail afterwards. Letting the send throw would answer with an error for
  a request that succeeded, and the caller would reasonably retry with a password that no
  longer works. The failure is logged.
- **argon2 parameters are the library defaults.** They already exceed every current OWASP
  Argon2id row. They are not yet stated explicitly at the call sites, which they should be,
  because `verify` reads them back out of the stored digest and changing them invalidates
  nothing.

## 13. Money is an integer column named for what it holds

`product_variants.price_cents` is an `Int` in minor units, so 1999 means 19.99. The ERD says
`numeric(10,2)`, so this is a deliberate departure and the reason is the wire: the contract
types Money as an integer, and Prisma 7 hands a `numeric` column back as a `Decimal`
instance that serialises to a **string**, not a number. Storing the integer means no
conversion inbound, none outbound, and none at Stripe, which speaks minor units too.

**Cost:** the schema no longer matches the ERD column for column, and a future requirement
for sub-cent precision would need a migration. **Why the name matters:** a column called
`price` holding 1999 is a trap for the next reader. One called `price_cents` is not.

## 14. A variant's size and colour are NOT NULL with an empty-string default

The contract promises 409 when a product already has a variant with a given size and colour
pair, and both fields are optional. The obvious model is two nullable columns and a unique
index, and it does not work: PostgreSQL treats two NULLs in a unique index as **distinct**,
so one product could hold two variants that both have no size and no colour, which is
exactly the duplicate the 409 exists to prevent.

PostgreSQL 16 has `NULLS NOT DISTINCT`, and Prisma 7.10 cannot express it, so an index
written by hand would exist in the database and not in the schema, and the next
`prisma migrate dev` would drop it. Storing the empty string gets the same guarantee inside
the schema language, and lets the unique index be the arbiter rather than a pre-read that
two concurrent creates could both pass.

**Cost:** the storage spelling and the wire spelling differ. `variant.mapper.ts` is the one
place they meet, and it drops the empty string so the response still shows absence, which is
what the contract requires of every optional value.

## 15. Deleting a product is soft, disabling it is not the same thing

`products.deleted_at` is set and the row survives, because order history points at the
variants of products that may since have been withdrawn. Three states have to stay distinct
and they are not synonyms: **deleted** is 404 for everyone including a manager, **disabled**
is 404 for everyone except a manager, and **out of stock** is a visible product with a
variant at zero.

The rule lives in one predicate, `visibleProductWhere`, and the list and the detail read both
call it. The writes do not: `updateProduct` and `deleteProduct` are manager only and resolve
through `assertProductExists`, which filters on `NOT_DELETED` alone, so a manager can still
update a product they disabled. `NOT_DELETED` is the piece all of those paths share, and it is
exported on its own for that reason.

**Deleting a variant is hard**, because nothing points at one yet. The contract already declares
a 409 there for a variant that appears on an order, and `deleteVariant` implements it rather
than deferring it: it counts `order_items` first, and catches the `P2003` foreign key violation
behind that count in case a row lands between the two statements. The branch holds the day order
items arrive instead of waiting for them.

## 16. `includeInactive` is a three-way answer, not a boolean

Anonymous plus `includeInactive` is **401**, a client is **403**, a manager is allowed. The
401 is the one worth explaining: the server cannot know whether an anonymous caller is a
manager until they say who they are, so refusing for lack of identity comes before refusing
for lack of permission.

This is also why `@OptionalAuth()` exists as a third state beside `@Public()`. A public route
returns before any token work, so a manager who did send a token would be invisible to the
handler.

## 17. `priceFrom` comes from one query for the whole page

The cheapest variant of each product on a page is a single `groupBy` over the page's ids,
not a query per row. The per-row version passes every review and is the N+1 this endpoint is
most likely to grow, so there is a test asserting the call count is one.

A product with no variants is absent from the result and therefore **absent** from the
response, rather than carrying zero. Zero would read as free.

## 18. Roles are enforced by a guard today and by CASL tomorrow

`RolesGuard` with a `@Roles('manager')` decorator, bound globally as an `APP_GUARD` beside the
token guard since `30dd481`, and after it in the providers array, so it reads a request the token
guard has already populated. It was bound per controller before that, which reached two of the six
and left deny by default unable to cover the other four.

The brief requires CASL, and this is the seam it replaces. **The swap is not confined to the
controllers.** `products.service.ts:46` and `:126` take the viewer as a parameter, `:56` branches
on `isManager`, and both hand the viewer to `visibleProductWhere`, so the catalog reads move with
the guard.

The 403 body is a bare `ForbiddenException` on purpose. Nest's default payload carries no
title and no detail, so the problem mapper falls back to the table, which holds the
contract's own wording. Supplying them at the throw site would risk drifting from it.

## 19. CORS is a list from the environment, and the proxy is a count

`configure-app.ts` called `app.enableCors()` with no argument, which is Nest's fully permissive
default. Measured against the package rather than read from its documentation:
`require('cors')(undefined)` answers `Access-Control-Allow-Origin: *` to an origin of
`https://evil.example`. That was on every route including the six manager-only catalog
mutations, one line below `helmet()`, whose entire purpose is the opposite. **Two independent
reviews of this branch named it, and neither `helmet` nor CORS had a single assertion anywhere:
`rg -in 'helmet|cors' test` exited 1.**

**The default is an empty list, which refuses every cross-origin browser call.** A service with
no configured front end should refuse rather than admit everyone, and a deployment that has one
names it. The wildcard was the convenient default; this is the safe one.

**`TRUST_PROXY_HOPS` is a count and never a boolean**, and the distinction is the entry.
`ThrottlerGuard` keys the rate limit on `req.ip`, and with `trust proxy` unset that is the
socket's address, so behind a load balancer every caller shares one counter and one abusive
client answers 429 to the whole store. `trust proxy: true` fixes the sharing and opens a worse
hole, because any client can then forge `X-Forwarded-For` and evade the limit outright. Express
reads the nth address from the right, so the number has to match the deployment.

**Given up:** the default of 0 keeps today's behaviour, which is correct with nothing in front
and wrong the moment something is. No test can catch that, because the end-to-end suite talks to
the process directly and `req.ip` there is the real client. It is a setting somebody has to know
to set, and saying so is the most this repository can do about it without an environment to
deploy to.

## 20. Two transitive advisories are overridden, not accepted

`npm audit` on this tree reported four high findings, and no code of mine is in the path.
`mysql2@3.15.3` (GHSA-3f6p-5ww8-9rcr, an authentication downgrade that leaks a plaintext
password) and `deepmerge-ts@7.1.5` (GHSA-ggr8-5vv4-36mx, stack exhaustion on a recursive
object graph) both arrive through `prisma@7.10.0`, the CLI package. The CLI is a
devDependency, and that would be the end of it, except that `@prisma/client@7.10.0` depends
on the CLI, so `npm audit --omit=dev` reports the same four and the `npm ci --omit=dev` in the
Dockerfile ships both packages in the runtime image. `npm view 'prisma@>=7.10.0 <8' version`
answers 7.10.0 alone, the `latest` tag is a release candidate of 8, and `npm audit fix --force`
offers 6.19.3, a downgrade across a major version to fix a driver this service never loads.

**The fix is an `overrides` block, a floor and not a pin.** `mysql2: ">=3.22.0"` and
`deepmerge-ts: ">=8.0.0"`. The first is a MySQL driver in a Postgres service:
`rg -n mysql src prisma test` exits 1, and the only adapter in the tree is
`@prisma/adapter-pg`, so the override changes bytes in `node_modules` that no code path
reaches. The second is not free. `@prisma/config` imports `deepmerge` and hands it to c12 as
the merger that assembles `prisma.config.ts`, so every CLI call goes through it. The 8.0.0
changelog names its breaking changes, `deepmergeInto` no longer mutating its inputs, two
metadata renames and the map-merge internals, and the variadic `deepmerge` export is not
among them. That is an argument, not a proof; the proof is that `prisma generate` and
`migrate diff` ran through the new version before this entry was committed.

**The CI step is the test.** An override is a promise about packages the project never calls,
so no unit test can fail when it stops being true. `npm audit --omit=dev --audit-level=high`
in the Verify job is the only assertion that can, and it audits the closure the image ships,
which is the one that matters. It exited 1 on the lockfile before the override and 0 after.

**Given up:** the floor is re-evaluated on every install, so a future advisory in either
overridden package is accepted silently until the audit step says otherwise, and a future
Prisma release that fixes this itself makes the block dead weight rather than wrong. It should
be deleted the day Prisma 7 ships a fix or 8 lands, and nothing in the repository will remind
anyone; this entry is the reminder.

## 21. Logs are pino JSON with a request id, and the events are the OWASP list

The filter used to log a 500 at error with the stack and every 4xx at debug with the message,
through Nest's console logger, and nothing else under `src` logged at all. `ARCHITECTURE.md`
promised a correlation id and said it did not exist. Three things were missing: a shape a log
query can filter on, an id that joins every line of one request, and the events the OWASP
logging cheat sheet asks a service to record, which are authentication successes and failures,
authorization failures, validation failures, application errors with a stack, and privileged
actions on an account.

**pino through `nestjs-pino`, and every existing `Logger` stays Nest's.** `app.useLogger` in
`configureApp` routes the `@nestjs/common` logger through pino, so the filter and the mailer kept
their `new Logger(Name)`, the two services gained one, and all of them got a request id without a
constructor change; every unit spec kept its `Logger.prototype` spy. The alternative was
`PinoLogger` injected everywhere, which is the same lines with a provider in every test module.
Winston was the other candidate the block text names; it is slower, JSON is a configuration there
rather than the default, and nothing here needs a second transport.

**The id is the caller's when it is well formed, and ours otherwise.** A front end or a proxy that
sends `X-Request-Id` gets the same value back and can join its trace to this one. The value is
accepted only when it matches `^[A-Za-z0-9._-]{1,64}$`, because a header is caller-controlled text
on its way into every log line of the request; anything else is replaced with a uuid and the
request proceeds. The response carries the header in both cases and CORS exposes it, so a browser
client can quote it. The contract does not declare it, on purpose: it is an operational header and
not part of any operation's meaning, the same standing the throttler's `X-RateLimit-*` headers
already have (`rg -c -i ratelimit contract/openapi.yaml` is 0).

**What a line never carries.** pino-http's default request serializer writes the headers, which is
the bearer token on every authenticated request. It is replaced with the id, the method, the path
and the address, the query string dropped for the reason `problem.filter.ts` records, and the
response serializer with the status code. `redact` still names `req.headers.authorization`, so a
future serializer that brings the headers back finds the token gone. No line is built from a body,
so no password or reset token can reach one, and the three account events carry a user id and
never the address.

**4xx moved from debug to info and warn.** A 401, a 403 and a 429 are the entries the list calls
security events, so they are warnings under their own event names, `auth.rejected`,
`authz.rejected` and `rate.limited`. Every other 4xx is what the caller sent and logs at info as
`request.rejected` with the problem type, which is where a validation failure lands. The old
debug level hid all of them from a default configuration, which is the opposite of what the list
asks for; the cost is a line per bad request from an anonymous caller, bounded by the same rate
limit that bounds the requests.

**Given up:** no end-to-end test reads a log line, because the suite runs at `silent` and pino
writes to stdout, so the shapes are proven by unit specs against the spy and the wiring by the
header that comes back. The id stops at the response: the job it was meant to reach does not
exist, and when it does the id has to be put on the job payload by hand, because
AsyncLocalStorage does not cross a queue. Nothing is a metric; the architecture page still lists
what would be.

## 22. The cart shows what can be bought, and checks stock as a courtesy

The contract says a cart is a live view: each line reads the price of its variant now, and a
manager who changes a price changes the subtotal of a cart that already holds it. Two things
follow from taking that literally, and the contract states neither.

**A line for a product that is no longer on sale leaves the view.** The read filters through the
relation with the same predicate the catalog uses for an anonymous viewer, `visibleProductWhere`,
so a product disabled or deleted after it was added is not shown, and the add and set paths
resolve the variant through the same predicate, which is where the contract's 404 for a withdrawn
product comes from. One rule, two places it shows. The row stays until the user removes it or
empties the cart, and the delete resolves the variant by id alone, so the user can always remove
what they can no longer see. The alternative, showing the line with its stock and letting the
checkout refuse it, tells a user about a product the catalog itself answers 404 for, and I did
not want the cart to be the one place a withdrawn product is still visible.

**The stock check happens before the write, and it is not the guarantee.** Both writes compare
the resulting quantity with the units on hand and throw the contract's `insufficient-stock` 409
before touching the row, so a 409 leaves the cart unchanged, as promised. Two adds racing past
the stock are accepted, because the contract makes the order the place where the number has to
be right: `createOrder` validates every line again and an unpaid order reserves nothing. A
transaction or a conditional update here would buy a guarantee the next operation has to give
anyway. The cost is a cart that can briefly hold more than the shelf, which the read reports
honestly through `stock`, and which the contract's own `CartItem` description anticipates.

**Given up:** no promo code, no tax, no delivery charge, so `subtotal` is the sum of the lines and
nothing else, which is what the contract says it is.

## 23. An order is placed by emptying the cart first, and moved by a conditional write

Two writes in this block could race with themselves, and the fix for each is the order of the
statements rather than a lock.

**Checkout deletes before it inserts.** Inside one transaction the service reads the cart's lines,
checks each against the stock, deletes exactly those lines, and only then creates the order. The
delete has to remove as many rows as the read returned, or the transaction ends in a 409. That
count is the whole concurrency story: two checkouts of one cart both read the lines, the second
blocks on the first's delete under read committed, then deletes nothing and rolls back, so a
double submit places one order and answers the other with "the cart changed". The alternative, a
`SELECT ... FOR UPDATE` through raw SQL, buys the same guarantee with a statement Prisma cannot
type. A second delete clears the rows the read did not show, the withdrawn lines of DECISIONS 22,
because the contract says the cart is emptied, and a line that reappears when a product is
re-enabled after an order would be a surprise.

**The snapshots are copied from what the check saw.** Name, size, colour and price go into
`order_items` from the rows the stock check ran against, so the order records the price the client
was shown at that instant, and a reprice between two statements of one transaction is impossible
by construction rather than by care.

**Stock is read and never written here.** The contract says an unpaid order reserves nothing and
the webhook lowers the stock, so the 409 for a line above stock is a courtesy at checkout too, the
same standing the cart's check has. What that means: between checkout and payment the shelf can
move, and the webhook's transaction is where the number is final.

**A status move is `updateMany` with the old status in its `where`.** The table in
`order-status.ts` says whether the move is legal for this caller and this status, and the write
then happens only if the status is still the one the table saw; zero rows is a 409. Without that, a
client's cancel and a manager's ship on the same order could both pass the table, and the second
write would overwrite the first, turning a shipped order into a cancelled one. The history row is
written in the same transaction, so the column and the history cannot disagree.

**Given up:** `pending` to `processing` is illegal even for a manager, because the brief advances
from `paid` and nothing pays an order yet, so until block 3 a manager cannot exercise the forward
path through the API, and the e2e suite sets `paid` by hand and says so. No promo code, so
`subtotal` equals `total`.

## 24. The webhook is the only writer of `paid`, and a retry is a unique violation

Stripe holds half of every payment's state, and the architecture page picked this as the seam
where a request fails halfway. This entry is what the seam looks like in code, and the three
places I chose against the obvious shape.

**One event kind per flow.** A payment link carries the order id in its own `metadata`, which
Stripe copies to every Checkout Session the link creates, so `checkout.session.completed` pays a
link order and records `payment_link`. A payment intent carries it in the intent's `metadata`, so
`payment_intent.succeeded` pays a cart order and records `payment_intent`. The link deliberately
puts nothing in `payment_intent_data`: a link purchase fires both events, and if the intent also
named the order the first to arrive would decide the recorded method by a race. With nothing
there, the intent event of a link purchase names no order and is ignored, and the method on the
row is always the flow the client actually used.

**The transaction, in this order.** The event id is looked up and then inserted first into
`stripe_events`, so a replay either stops at the lookup or loses on the primary key and rolls the
whole transaction back. Then `updateMany` moves the order from `pending` to `paid` in one
conditional write; zero rows means a cancel or the other event kind landed first, and the answer
is still 200 with a warning, because a non-2xx makes Stripe retry and no retry can change that.
Then the history row. Then each line's stock comes down, conditional on the units being there.
The ERD's `order_payments` table, which the contract still names at `openapi.yaml:1710`, would
have carried the Stripe reference; `stripe_events` carries it on the primary key, which is the
one place idempotency needs it, and the schema comment on `Order.paymentMethod` records the rest
of that departure.

**Oversold means the stock floors at zero.** Between the intent and the payment the shelf can
move, because an unpaid order reserves nothing (DECISIONS 23). When the payment lands and the
units are gone, the money is already taken, so refusing is not on the table: the stock is set to
zero and a `stock.oversold` warning names the variant and the shortfall, which is the number a
person has to act on. The alternative, reserving stock at intent creation, would need an expiry
and a sweeper for intents that never pay, and the brief's flow does not ask for either.

**Everything that is not a signature failure is 200.** An unhandled event kind, an event that
names no order, and an event for an order that is no longer pending all answer 200, the last two
with a warning and a recorded event id. Stripe treats anything else as a reason to retry, and
none of those answers would change on a retry. The signature is the one 400, because a body that
does not verify is not Stripe's, and the raw bytes are what it covers, which is why `main.ts` and
the test factory both keep `rawBody`.

**The SDK is a token and the gateway is a class.** `STRIPE_CLIENT` provides a three-method
interface a real `Stripe` instance satisfies; the e2e factory replaces the two API calls with a
stub that records what was asked, and keeps the SDK's own `webhooks`, so the signature check in
the suite is the production code path against a body the suite signed with the same secret. That
is the Week 3 & 4 page's instruction taken literally: stub the API you cannot run, and never
accept a webhook you have not tested against a signature.

**Given up:** two intents for one order are allowed, because the contract calls the operation a
payment attempt and reads none back; the conditional write makes the second success a no-op, and
a double charge is a refund, which no operation in this contract performs. A payment link never
expires, so `expiresAt` is never sent. The link's order is deleted if Stripe fails after it was
written, which is a compensation and not a transaction, and a crash between the two leaves a
`pending` order with no link, the same shape of gap the architecture page already admits for the
queue.

## 25. CASL decides at the controller, and the where clause comes from the ability

DECISIONS 18 named `RolesGuard` as the seam CASL would replace and warned that the swap reaches
the services. This is the swap, and the warning was right in one more place than it named.

**The abilities are one factory with three callers.** Anyone reads the catalog, with the product
rule carrying the shopper's visibility condition. A signed-in caller manages their own cart,
creates orders, and reads, cancels and pays their own; the delivery person has exactly that until
the optional delivery feature exists, because the contract gives the role nothing else. A manager
writes the catalog, reads every product that is not deleted, and manages every order. Two verbs
are the brief's and not CASL's: `cancel` and `pay`, so that a client's two rights over an order are
not spelled `update`, which is the manager's advance. `manage Order` is what makes "view all
orders" expressible next to "read my orders": a CASL check for `manage` passes only a `manage`
rule, where a check for `read` passes the client's conditional rule too.

**The check at the controller is on the subject type, because that is what a guard can know.**
`@CheckPolicies` names one or more questions, the guard builds the ability from the token and
requires every answer to be yes, and a handler with no policy is 403 for everyone, the loud
failure the previous guard was built around. The condition, "own", cannot be checked before the
row is read, so it becomes the `where`: `accessibleBy(ability).Order` is the rule's own condition
as a Prisma clause, `{ userId }` for a client and nothing for a manager, and `getOrder`,
`setOrderStatus` and `createPaymentIntent` resolve through it. Another client's order and a
missing order are the same 404 by construction, which is what the contract asks and what the
old `ownedBy` did by hand. The catalog reads do the same: `accessibleBy(ability).Product` is the
visibility rule, and the manager's list adds `isActive: true` when the flag was not set.

**The one decision that was in a service moved to the guard.** Asking for the inactive products
answers 401 for nobody and 403 for a client, and `listProducts` used to produce that pair
itself. The policy reads the raw query flag and the guard answers 401 when there is no user and
403 when there is, so the service has no branch on who is asking, which is what "enforce at the
controller level" means when taken literally. The status table lost its role parameter the same
way: who may cancel or advance is the ability's answer, checked on the row with `subject()`
because a Prisma row carries no class, and the table keeps what may follow what.

**The document follows the marker.** `@Roles` composed `@ApiBearerAuth`, so the served document
could not disagree with the guard; `@CheckPolicies` composes it now and `@OptionalAuth` keeps only
the empty requirement, so an optional route is the pair and the drift suite reads it as it did.

**Two things stayed where they were.** `visibleProductWhere` is still the predicate the cart and
the checkout use for "on sale", and its docstring now says it is the anonymous ability's condition
written out; deriving it from an ability the cart does not have would be a second factory call
for the same clause. The `customer` member of an order stays on `isManager`, because whether a
response carries the client is a presentation rule the contract states in terms of the caller
being a manager, not an authorization decision.

**Given up:** no field-level rules, so a manager who may update a product may update every
column of it; the delivery role has no rule of its own; and `@casl/prisma` reads its types from
`@prisma/client` by default, which the Prisma 7 generator no longer fills, so `casl-prisma.ts`
is the wrapper the package's README gives for a generated client, and it is one more file that
knows where the client lives.

## 26. A like needs a product on sale, an unlike needs only a variant, and the list is the product page

The three like operations are the smallest feature in the contract, and they still forced three
calls.

**Two lookups, two rules.** `likeVariant` resolves the variant through
`visibleProductWhere(undefined)`, the predicate the cart uses for "on sale", so liking a variant of
a disabled or deleted product is the same 404 as adding it to the cart. `unlikeVariant` resolves
through `NOT_DELETED` alone, the rule `variants.service.ts` already applies to a variant, because a
like placed while the product was on sale must still be removable after a manager disables it. The
asymmetry is the point: a like is refused where the storefront shows nothing, and an unlike is
refused only where there is no variant at all. The e2e suite proves both halves, a 404 on the like
of a disabled product's variant with no row written, and a 204 on the unlike of a variant nobody
liked.

**The list is the product list with one more clause.** The contract says an entry has the same
shape as an entry of the product list and that a product with two liked variants appears once.
Rather than a second mapper, `ProductsService.pageOf(where, query)` is now the page assembler both
lists call: the rows and the count under one `where`, the cheapest variant and the primary image in
one query each, then the mapping. The likes service hands it `accessibleBy(ability).Product` and
`variants: { some: { likes: { some: { userId } } } }`, so one row per product is a property of the
predicate and not of a `distinct`. Reading under the caller's own ability means a liked product
that was disabled after the like leaves the list and its row stays, which is what the storefront
shows anyway, and a manager who disabled it still sees it in their own list, because their ability
reads disabled products.

**What the row is.** The pair, and nothing else. No surrogate id, no timestamp, no counter: the
contract exposes none of them, and the primary key is what makes `PUT` an upsert with an empty
`update` and `DELETE` a `deleteMany` whose count is ignored. Both are idempotent because the key
makes them so, not because a handler checks first.

**Authorization is one rule.** `manage ProductLike` on the caller's own `userId`, for every
signed-in role. The contract declares no 403 on any of the three operations, and a manager likes
things for the same reason a client does. The list's `where` takes the user id from the token and
not from `accessibleBy(ability).ProductLike`, because the predicate sits inside a relation filter
where CASL's clause has no place to go; the ability still answers the guard, and the factory spec
pins the instance checks and the clause.

**Given up:** no like count on a product, which the contract does not ask for; and an unlike on a
variant of a deleted product is a 404 rather than a silent 204, because the variant rule says a
deleted product's variants do not exist, so a like that outlives a deletion is one unreachable row
until the product row goes.

## 27. Low stock is a crossing, the producer decides after the commit, and it is one job per person

Feature 8 says "when the stock of a product reaches 3, notify users who liked the product but
haven't purchased it yet", by a background job, by email, with the product's image. This entry is
the half that decides who and when. The worker and the mail are the next one.

**Reaches means crosses.** A purchase of two units from four leaves two and never shows a three,
and the point of the feature is a warning before the variant sells out, so `crossesLowStock` fires
when a write takes the stock from above three to three or below, and never on a rise. The threshold
is per variant, because the like is (DECISIONS 26, and the ERD ledger's decision 15). This
repository used to call the message a restock mail, in the page, in two schema comments and in the
contract's description of `stock`; that was the wrong word for the brief's sentence, and the three
places now say low stock. Stock oscillating at the threshold fires on every downward crossing, and
the row the worker writes is what keeps that from mailing a person twice.

**Two writers, one rule.** The webhook and the manager's stock count are the only writes to
`product_variants.stock`, and both hand `{ variantId, before, after }` to `LowStockProducer.notify`
after their own write is done. The webhook reads the stock after the decrement and adds the quantity
back for the value before, one read fewer than reading it first; the oversold path already reads the
value before it floors. The count already reads the row for its 404.

**The audience is three clauses on the user.** Liked the variant; no `stock_notifications` row
for it; no line for it in an order whose status is not `pending` or `cancelled`. "Purchased" is
money taken: the contract says a pending order reserves nothing, and a cancelled order bought
nothing. The buyer whose payment caused the crossing is excluded by the third clause, since their
order is `paid` by the time the producer runs.

**After the commit, one job per recipient, and nothing thrown.** The page says the enqueue waits
for the commit so a queue outage cannot fail a paid order, and it names the gap: a crash between
the commit and the enqueue loses the job. So `notify` runs after the log line, catches everything,
and writes `stock.notify-failed` at error; the webhook still answers 200 and the count still answers
the row. One job per recipient rather than one per variant, because BullMQ is at-least-once and
retries are per job, so a job dying halfway through a list would resend everything before it. The
id is `low-stock:<variant>:<user>`, and BullMQ ignores an add whose id exists, so two crossings
before the worker runs leave one job. A completed job is removed and frees its id, and the database
row takes over then. A job that failed its attempts keeps its id in the failed set, which the page
names as the thing to watch, until somebody clears it.

**BullMQ 6.3.4 over ioredis 6.0.0, behind a token.** This major of BullMQ ships no Redis client:
it loads `ioredis` as an optional peer at the first command and refuses without it, so both are
dependencies. `STOCK_QUEUE` is the token and `StockQueue` its two methods, the `StripeClient` shape
again: the producer spec hands it a plain object, the boot spec replaces it so `compile()` opens no
socket, and the e2e suite keeps the real one against the Redis `docker-compose.yml` runs, on
database 1 so the suite's keys never share the development queue's. `connection: { url }` is what
this version hands to ioredis, read from the package rather than remembered. The job defaults are
three attempts with an exponential backoff from one second, completed jobs removed, failed jobs
kept. `REDIS_URL` is required again, which its own docstring said would happen the day something
opened the connection, and CI runs `redis:7-alpine` beside postgres.

**Given up:** the request id does not travel in the job. The `stock.low` line carries the request
id through the logger and the job ids as its payload, so a mail is traced back to the write through
that line and not through the job. And the audience query runs inside the request, one per
crossing: a variant with ten thousand likers would enqueue ten thousand jobs inside the webhook's
response time, which is the day the producer itself becomes a job.

## 28. The worker writes the row before the mail, and a failed send takes the row back

The consumer half of Feature 8: one job, one person, one mail, once. DECISIONS 27 decided who
and when; this is how the mail goes out and how it does not go out twice.

**The row first, then the mail, and the row removed when the mail fails.** `stock_notifications`
is keyed on the pair, and the processor inserts it before it sends, so two workers holding the
same pair, two crossings before either ran, or a retry of a job whose worker died after sending,
meet the primary key and only one sends. The other order, mail then row, would let both send in
that window, and the row exists to close exactly that window; the schema comment said so before
the worker existed. What the insert-first order costs is a send that fails after the row: the
retry would find the row and count the person as told. So a rejected send deletes the row and
rethrows, the job fails its attempt, and the next attempt inserts and sends again. A crash between
the row and the mail loses that one mail, the same class of gap the page accepts between the
commit and the enqueue, and a `P2002` on the insert is the "already told" answer with no mail.

**A mail method that throws, beside two that swallow.** `sendPasswordReset` and
`sendPasswordChanged` swallow a failed send on purpose, and their docstring says why: their
callers are requests that have already committed or must answer 202 unconditionally. The
low-stock mail's caller is a job, and a job's attempts are the retry, so a swallowed failure would
count as delivered. `sendLowStock` calls the throwing half, `deliver`, which the other two wrap in
their catch. The mail carries the product's image as an `img` in an HTML body, with the text body
naming the same URL, because the brief says "include the product's image in the email" and a
client that blocks remote images still gets the words. The name a manager typed is escaped.

**A second entrypoint, not a flag.** `src/worker.ts` boots `WorkerModule` as an application
context: the same configuration, logger, database and mailer as the API, no port, no controllers,
no guards. The page promised "same image, different entrypoint", and the reason holds: the API and
the worker scale apart, and a slow mail provider never holds a request. The Dockerfile's one image
runs either as `node dist/src/main.js` or `node dist/src/worker.js`. Concurrency is five, because
the bound is the mail provider's rate and not Postgres, and five in flight is what a provider's
free tier tolerates.

**The failed set is the alert, and it is proven once.** Three attempts with an exponential backoff
from one second, completed jobs removed, failed jobs kept. The e2e suite boots the worker beside
the API with the mail spy shared, and shows the four outcomes against the real queue: the mail with
the image and one row; a send that fails once and arrives on the second attempt; a pair already
told, no mail and the row kept; and a send that fails every attempt, no row, no mail, and one job in
the failed set. The last is the page's "failed set's size" made observable. What clears the set is
a person, on purpose, after the mail provider is back.

**Given up:** the job carries no request id, so a mail traces back to its write through two log
lines, the enqueue line with the job ids and the worker's line with the job id; and the `P2003`
path, a person or a variant deleted between the enqueue and the send, is a warning and a skip
rather than a failure, because nothing can be sent to a row that is gone.

## 29. One CloudFormation stack: ECS on one instance behind CloudFront, with the managed parts managed

The brief requires a deploy, the mentor's scope message of 2026-09-01 says a cloud rebuild is out
of it, and the page promised a container image, a managed Postgres, a managed Redis and an object
store. `infra/stack.yml` is that, deployed and torn down with one command each, and this entry is
what it chose and what the first release taught.

**ECS on one EC2 instance, not Fargate.** Fargate needs a load balancer for a stable origin and
pays for a public address per task, and on this account those two lines would outspend the
compute. One `t4g.micro` with an Elastic IP is the origin, the two containers are one ECS service
on it, and the managed parts stay managed: RDS Postgres 16 and an ElastiCache Valkey 9 node,
each answering the instance's security group and nothing else. Priced with
`aws pricing get-products` against "US East (Ohio)", on demand: the instance 0.0084 USD an hour,
the database 0.0160, the cache 0.0128, the address 0.0050, so about 31 USD a month plus 20 GB of
gp3 storage at 0.115 USD per GB-month. The account's 120 USD of credits carry that for about
three and a half months, which is longer than the review.

**CloudFront is the HTTPS front, and no domain was bought.** A distribution gives the API a
public HTTPS name for free, caches nothing, passes every method and every header but `Host`
through, and forwards the caller's address so `TRUST_PROXY_HOPS=1` makes the rate limit per
client again. The instance admits port 80 from CloudFront's origin-facing addresses only, which
the smoke test proves by timing out on the Elastic IP. The origin's name is the instance's public
DNS composed from the address, because the address is the one thing that survives an instance
replacement. Stripe's rule that a webhook endpoint be HTTPS is met by the distribution's domain.

**arm64, because both builders are.** The laptop builds arm64 natively, GitHub's free
`ubuntu-24.04-arm` runner does too, and `t4g.micro` is the cheapest instance offered; nothing
emulates anything. The instance type and the AMI are parameters, so x86 is one override away.

**Secrets in two stores, on purpose.** The five values a person types live in SSM Parameter
Store as SecureStrings, which cost nothing, and the task reads them at start. The one value
CloudFormation composes, `DATABASE_URL` from the database's endpoint and the password, lives in
Secrets Manager, because CloudFormation cannot write a SecureString and the application reads one
URL, not parts. No secret is in the template, the task definition or a log line.

**The release is registry, migrate, roll, from a third image stage.** `prisma migrate deploy`
needs the CLI and `prisma/migrations`, which the runtime stage leaves behind on purpose, so the
Dockerfile gained a `migrate` target: the build stage with one command, run as a one-off ECS task
before the new tag takes traffic. The seed runs from the same stage with one override.

**What the first release taught, and what changed because of it.**

- ElastiCache creates Valkey only as a replication group; a cache cluster refuses the engine.
- The default parameter group evicts keys under memory pressure, and BullMQ warns on every
  connection that a queue must never do that. The stack carries its own group with `noeviction`.
- RDS Postgres 16 refuses a plaintext connection, `rds.force_ssl` is 1 by default. The Prisma
  CLI negotiates TLS on its own, so the migrations applied, and the driver the application and
  the seed use sends plaintext, so the seed was refused with `P1010`. `DATABASE_SSL_CA` names the
  RDS certificate bundle the image now carries, and the driver verifies the server against it,
  hostname included; on a laptop the variable is blank and the compose container is plain.
- The seed command rebuilt the project inside a 512 MiB container and ran out of heap; the
  compiled seed is already in the image, so the task runs `node dist/prisma/seed.js`.
- A one-off task runs beside the live one, which reserves 448 of the host's 916 MiB, so the
  migrate task asks for 384 and not 512.
- A tag pushed from a laptop can be a stale image: the first push carried a runtime image built
  five days earlier, because the local tag had never been rebuilt. Caught by the image's date
  before the tag rolled. The deploy job builds from the commit, which is why it is next.

**Given up:** no Auto Scaling group, so a dead instance is a stack update and not a self-heal;
no SSH, the shell is Session Manager through the instance role; one task at a time, because host
port 80 admits one, so a deployment is a few seconds of 504 from CloudFront; and the tag rolled
this once is the commit the work started from plus this checkpoint's changes, which the job
makes exact from AWS-2 on.

## 30. Every push releases through a role GitHub assumes, and the stack changes through a role of its own

DECISIONS 29 released once by hand and recorded a stale image reaching the registry that way.
This is the job that makes a push the release, and the trust it runs on.

**No key in GitHub.** A run presents GitHub's short-lived OIDC token to STS and gets the role
`tshirt-deploy` for an hour, and the role's trust names one repository and two refs, the working
branch and `main`, so a token from any other repository or branch is refused before any
permission is checked. Nothing is stored: no access key in a secret, nothing to rotate, nothing
to leak from a fork. `infra/ci.yml` is that trust, deployed once by a person, and the two role
ARNs it outputs are repository variables rather than literals, so the account id stays out of a
public file. The subject the trust names carries GitHub's numeric ids,
`repo:f3r21@31838677/t-shirt-store-api@1347606623:ref:...`, because that is the immutable form
the token carries now: the first run named the repository by its names alone, STS answered "not
authorized", and CloudTrail's record of the refused call showed the ids. The ids survive a
rename and are never reissued, which makes them the better key.

**The job holds the small permissions and the stack holds the large ones.** `tshirt-deploy` may
push to one registry, ask CloudFormation for a change set on one stack, run one task definition
on one cluster, pass the task's two roles to ECS, and read one log group. It cannot touch an
instance, a database, a cache or a role. The change set executes as `tshirt-cloudformation`, a
role only CloudFormation in this account can assume, with `PowerUserAccess` and an IAM policy
limited to the stack's own `tshirt-*` roles and instance profile. That role is powerful on
purpose: it stands in for the administrator who ran the first release, and the only way to use
it is a change set on this stack from a run that already passed the trust above.

**Two tags, two updates.** The template gained `MigrateImageTag` beside `ImageTag`. A release
sets the migrate tag first, which changes one task definition and no service, runs the
migrations from the new image, and only then sets `ImageTag`, which rolls the service. With one
parameter the service would roll before the migrations ran, which is the order the page forbids.

**The tag is the commit, and the run proves it.** The job builds both images from the checkout
on GitHub's arm64 runner, the instance's architecture and the laptop's, so nothing is emulated,
and its last step reads the running task's image back and fails unless it carries the commit's
tag; then `GET /v1` through CloudFront. The by-hand release could not make that claim.

**A release is never cancelled.** The workflow cancels an older run when a newer push arrives,
except on the two releasing refs, where a run in flight finishes: a cancelled job between the
migrations and the roll would leave the next run to repeat both, and a cancelled change set
completes on its own anyway.

**The AMI is pinned.** The first template resolved the ECS image from AWS's SSM path at every
update, which would have replaced the instance on whichever release followed AWS's next weekly
publication. It is a fixed id now, bumped on purpose.

**Given up:** the release runs from a feature branch, which is where the graded work lives, and
`main` inherits it at the merge; no environment protection rule or approval gate, because the
tests are the gate; no rollback beyond the circuit breaker, which returns a service that never
became healthy to the previous task definition; and a service role wider than the stack
strictly needs, bounded by who can assume it rather than by what it can do.

## 31. Images live in a closed bucket, are served through the distribution, and are what their bytes say

The last two contract operations, and the brief's "S3 for static files". The schema comment on
`product_images.url` promised a plain CDN address the API returns verbatim; this is how it is
kept.

**A closed bucket behind the same front.** Nothing reads the bucket but the distribution, which
signs its requests through an origin access control, and the bucket policy admits that one
distribution for `GetObject` alone. A behaviour on `images/*` caches with CloudFront's optimized
policy, so an image's URL is `https://<distribution>/images/products/<id>/<uuid>.<ext>`: the
same host the API answers on, no public bucket, no signed URL to expire inside a cached page.
Every key is a uuid, so an object never changes under its URL and carries a one-year immutable
cache header; a replaced image is a new key. The cost is on delete: an object removed from the
bucket can be served from the edge until its TTL runs out, a day at most, and no invalidation is
made, because the first thousand a month are free and the ones after are not, and a stale
picture of a T-shirt for an afternoon is not worth a paid call per delete.

**The type is read from the bytes.** PNG, JPEG, GIF and WebP by their signatures, in
`image-type.ts`; a text file declared `image/png` is 415, which the e2e suite sends on purpose.
The header the client declares is whatever the client chose. The size limit is 5 MiB, enforced
by multer while the body streams, so a file above it is 413 before a byte of it is stored; the
contract names the limit and leaves the number to the server.

**The object first, then the row; the row first, then the object.** An upload writes the
object, then in one transaction clears the previous primary when asked and creates the row,
and a row that fails takes its object back down. A delete removes the row, then the object,
and an object that will not go is logged as `image.orphaned` and left, because a URL the API
still shows is worse than one object nobody references. A manager may add an image to a
product they disabled, the way `updateProduct` lets them edit it.

**The store is a token.** `OBJECT_STORE` with two methods, the `StripeClient` shape: the e2e
suite keeps the whole application real and replaces the store with a map, the S3 binding has a
unit spec that pins its two commands, and the credentials come from the task role in the
container and from `AWS_PROFILE` exported in a laptop's shell, never from a file, because
`ConfigModule` runs with `skipProcessEnv` and a value in `.env` would not reach the SDK anyway.

**Two more required variables**, `S3_BUCKET` and `IMAGES_BASE_URL`, blank in the example file
with the stack outputs named as their source, the Stripe keys' treatment: an upload that
silently had nowhere to go would be worse than a boot that refuses.

**A manager by name in the seed.** `SEED_MANAGER_EMAIL` promotes one existing account when the
seed task runs with it, in any environment, idempotently. The deployed store gets its manager
that way; the demo accounts with the published password stay out of production as before.

**Given up:** no image resizing or format conversion, the bytes are stored as sent; no limit on
how many images a product carries; and the edge TTL above.
