# 19. CORS is a list from the environment, and the proxy is a count

Status: accepted
Date: 2026-09-01

## Context

`app.enableCors()` with no argument answers `Access-Control-Allow-Origin: *` to any origin,
measured against the package. It stood one line below `helmet()`, and no test asserted
either. Behind a load balancer `req.ip` is the address of the balancer, so every caller shares one
rate-limit counter, and `trust proxy: true` lets any client forge `X-Forwarded-For`.

## Options

- `CORS_ORIGINS` as a list, empty by default, and `TRUST_PROXY_HOPS` as a count (chosen).
- The permissive default: every route open to every origin.
- `trust proxy: true`: the forgery above.

## Decision

An empty list refuses every cross-origin browser call, and a deployment with a front end
names it. Express reads the nth address from the right, so the count matches the deployment:
1 behind CloudFront.

## Consequences

**Gives up:** the default of 0 is wrong the moment a proxy stands in front, and no end-to-end
test can see it, because the suite talks to the process directly.

**Revised 2026-09-04:** `ARCHITECTURE.md` is one page, so the two paragraphs it carried on the
security posture moved here, minus the sentences this record already stated. The page keeps a
pointer to this one.

Ahead of the OWASP list, a replayed webhook: Stripe retries, and a replayed
`payment_intent.succeeded` that lowered the stock twice would be silent. The event id is the
primary key of `stripe_events`, inserted first in the paying transaction, and the suite
replays a signed event and asserts that the stock moved once. A01, broken access control, is
first on the list, because one global guard is the only thing standing there. It is CASL: an
ability per caller, a policy on every handler, deny by default, and the ownership conditions
turned into the where clauses the services read with, so another client's order is a 404 by
construction. A07 second: `argon2.hash` takes no options, so its cost is the library default,
and reuse detection accepts a spent token for ten seconds after rotation without raising the
alarm, the hole ADR 2 prices. API4 third, three tiers by route, and the last paragraph below
names the setting it depends on.

One regression would reach production unnoticed, and it is a setting. `ThrottlerGuard` keys
the limit on `req.ip` (`app.module.ts`, no `getTracker` override). `TRUST_PROXY_HOPS` carries
the answer as a count, default 0: `trust proxy: true` would fix the sharing and open a worse
hole, because any client could then forge `X-Forwarded-For` and evade the limit. What a test
does catch is the other half: `app.e2e-spec.ts` asserts helmet's headers and asserts that an
origin outside `CORS_ORIGINS` gets no `Access-Control-Allow-Origin`.
