# Architecture

Read the diagram first. Everything drawn is built and running.

```mermaid
%%{init: {"flowchart": {"nodeSpacing": 70, "rankSpacing": 70}}}%%
flowchart TB
    code["Commit<br/>pre-commit hook"]
    ci["CI, every push<br/>typecheck, lint, format,<br/>unit, e2e, image, deploy"]
    citest[("Postgres,<br/>e2e service container")]
    deploy["Deploy<br/>registry, migrate,<br/>then roll the tag"]

    client["Client<br/>browser or mobile"]
    api["API, NestJS<br/>helmet, CORS, policies guard,<br/>throttler with a<br/>per-process counter"]
    pg[("PostgreSQL<br/>users, catalog, carts, orders<br/>20 connections per task,<br/>76 usable, so 3 tasks")]
    casl["CASL abilities<br/>a dependency, not a guard"]
    store[("Object storage<br/>product images")]
    smtp["Mail provider,<br/>from the task role"]
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

The shared ceiling is Postgres. ADR 35 records the choice and what would move it.

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
identical.

**Switch:** when a second consumer needs the same event under a different routing rule, say
fulfilment subscribing to a paid order beside the mail worker, RabbitMQ. BullMQ makes each
new consumer an edit to the producer; one exchange and two bindings makes it a deployment.

**Gives up:** a crash between the commit and the enqueue loses the job. The fix I did not
build is a transactional outbox.

## How it deploys

One CloudFormation stack in `infra/`: the image on one arm64 ECS instance behind CloudFront
for HTTPS, a managed Postgres, a managed Valkey, and an object store. Not serverless: a pool
per invocation multiplies connections by concurrency until the database refuses them. The
release, registry then `prisma migrate deploy` as a one-off task then the tag rolled, is a
job per push to `main` that assumes a role through GitHub's OIDC token and stores no key.
Mail goes out through SES from the same task role, so no relay password exists either.

Rollback is the image, never the schema, so migrations are forward-only and additive.

## Where a request fails halfway

The seam is the payment webhook, because Stripe holds half the state. It is the only writer
of `paid`, and stock comes down inside the transaction that sets it, so a disagreement is one
failed transaction, not two drifting systems. The Stripe event id is the primary key of
`stripe_events`, inserted first in that transaction, so a retry is a unique violation. ADR 24
records the rest.

## How I know it still works, and what I would watch

Per route: request rate, 4xx against 5xx, p95 latency, and saturation as pool usage and
event loop lag. Then what no infrastructure metric shows: checkout conversion, webhook lag,
the failed set's size, and stock going negative, which pages. Logs are pino JSON on stdout.
The job carries no request id: the enqueue line names the request id and the job ids, and
none of the metrics in this section exist yet.

ADR 19 records where the security risks are, and the one setting no test catches.
