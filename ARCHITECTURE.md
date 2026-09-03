# Architecture

Read the diagram first. Everything drawn is built and running.

```mermaid
%%{init: {"flowchart": {"nodeSpacing": 70, "rankSpacing": 70}}}%%
flowchart TB
    code["Commit<br/>pre-commit hook"]
    ci["CI, every push<br/>typecheck, lint, format,<br/>unit, e2e, image, deploy"]
    citest[("postgres:16-alpine<br/>e2e service container")]
    deploy["Deploy<br/>registry, migrate,<br/>then roll the tag"]

    client["Client<br/>browser or mobile"]
    api["API, NestJS<br/>helmet, CORS, policies guard,<br/>throttler with a<br/>per-process counter"]
    pg[("PostgreSQL<br/>users, catalog, carts, orders<br/>pool of 10 per process,<br/>97 usable, so 9 replicas")]
    casl["CASL abilities<br/>a dependency, not a guard"]
    store[("Object storage<br/>product images")]
    smtp["SES<br/>from the task role"]
    stripe["Stripe"]
    valkey[("Valkey<br/>stock queue")]
    worker["Worker<br/>same image,<br/>different entrypoint"]

    code --> ci
    ci --> citest
    ci -.-> deploy
    deploy -.->|"image, then migrations"| api

    client -->|"HTTPS, bearer token"| api
    api --> pg
    api -->|"who liked it"| pg
    api --> casl
    api -->|"images"| store
    api -->|"reset and changed mail"| smtp
    api -->|"create intent or link"| stripe
    api -->|"after the commit,<br/>one job per recipient"| valkey
    stripe -->|"signed webhook"| api
    valkey --> worker
    worker -->|"low-stock mail"| smtp
```

The shared ceiling is Postgres. `prisma.service.ts` builds `PrismaPg` without a pool size,
so the pool is `pg`'s default of ten per process and the ceiling is replicas times ten.
Postgres here reports `max_connections=100` with three reserved for the superuser, so nine
replicas fit inside the 97 usable and a tenth does not. That ten is inherited rather than
chosen, and it belongs in the environment beside the replica count.

## What comes off the request path

One thing is queued: when a variant's stock reaches three, everyone who liked it and has not
bought it gets an email, which is one write and then unbounded calls to a mail provider. The
enqueue waits for the commit, so a mail outage cannot fail a paid order, and retries are per
recipient, because BullMQ is at-least-once and a job dying mid-list resends everything before
it.

Why BullMQ. Valkey is already provisioned for the throttler's counter once it is shared
across replicas, and one job type does not use what a broker sells. I rejected RabbitMQ:
exchanges, bindings and inter-queue dead-lettering are routing this system has no second
consumer for, and its at-least-once guarantee is the same, so the idempotency work is
identical. I rejected pg-boss: it adds no service, and pays for that by polling the Postgres
that is already the ceiling.

**Switch:** when a second consumer needs the same event under a different routing rule, say
fulfilment subscribing to a paid order beside the mail worker, RabbitMQ. BullMQ makes each
new consumer an edit to the producer; one exchange and two bindings makes it a deployment.

**Gives up:** a crash between the commit and the enqueue loses the job. The fix I did not
build is a transactional outbox.

## How it deploys

One CloudFormation stack in `infra/`: the image on one arm64 ECS instance behind CloudFront
for HTTPS, a managed Postgres, a managed Valkey, and an object store. Not serverless: a pool
per invocation multiplies connections by concurrency until the database refuses them. CI runs
the typecheck, the linter, the formatter, both suites and a `docker build` on every push. The
release, registry then `prisma migrate deploy` as a one-off task then the tag rolled, is a
job per push to `main` that assumes a role through GitHub's OIDC token and stores no key.
Mail goes out through SES from the same task role, so no relay password exists either.

Rollback is the image, never the schema, so migrations are forward-only and additive. Seven
of the eight are. The second drops `users.reset_token` in the same statement that adds
`reset_token_hash`, so a replica still on the previous image breaks mid-rollout. That rename
needed expand and contract.

## Where a request fails halfway

The seam is the payment webhook, because Stripe holds half the state. It is the only writer
of `paid`, and stock comes down inside the transaction that sets it, so a disagreement is one
failed transaction, not two drifting systems. The Stripe event id is the primary key of
`stripe_events`, inserted first in that transaction, so a retry is a unique violation.
`payments.service.ts` is that transaction: the event row, then one conditional write from
`pending` to `paid`, then the history row, then each line's stock, and every answer but a bad
signature is 200 because Stripe retries anything else. When the units are gone by the time
the payment lands, the stock floors at zero and a warning names the shortfall, because the
money is already taken. ADR 24 records the rest.

## Where the security risks are

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

## How I know it still works, and what I would watch

Per route: request rate, 4xx against 5xx, p95 latency, and saturation as pool usage and
event loop lag. Then what no infrastructure metric shows: checkout conversion, webhook lag,
the failed set's size, and stock going negative, which pages. Logs are pino JSON on stdout.
Every line carries the request id, which a caller may set with `X-Request-Id` and reads back,
and the filter writes one line per failure with the event, the status, the problem type, and
the user id once a token verified, never a token. The job carries no request id: the enqueue
line names both, and none of the metrics in this section exist yet.

One regression would reach production unnoticed, and it is a setting. `ThrottlerGuard` keys
the limit on `req.ip` (`app.module.ts`, no `getTracker` override). With `trust proxy` unset,
`req.ip` behind a load balancer is the balancer, so every caller shares one counter and one
abusive client answers 429 to the whole store. `TRUST_PROXY_HOPS` carries the answer as a
count, default 0: `trust proxy: true` would fix the sharing and open a worse hole, because
any client could then forge `X-Forwarded-For` and evade the limit. A service put behind a
proxy by someone who does not set it is back where it started, and no test catches that,
because the end-to-end suite talks to the process directly and `req.ip` there is the real
client. What a test does catch is the other half: `app.e2e-spec.ts` asserts helmet's headers
and asserts that an origin outside `CORS_ORIGINS` gets no `Access-Control-Allow-Origin`.
