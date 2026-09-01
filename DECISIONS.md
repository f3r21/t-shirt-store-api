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
fires. `REFRESH_GRACE_SECONDS` is an environment variable rather than a constant precisely
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

The column is plain text behind a case-sensitive unique index, so without normalisation
`ana@example.com` and `ana@EXAMPLE.com` register as two accounts, and three operations look
an address up by equality.

The **whole** address is folded, not only the domain. RFC 5321 leaves the local part
case-sensitive, so this is a product decision rather than a standards one: no mail provider
a customer of this store is likely to use treats `Ana@` and `ana@` as two people, and two
accounts for one person is the worse failure. **Not yet done:** the durable form is a unique
index on `lower(email)` or a `citext` column, so that a second code path cannot reintroduce
the gap. Today the normaliser is the only writer.

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
