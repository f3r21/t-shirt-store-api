# Architecture

Everything drawn is running.

```mermaid
flowchart TB
    code["Commit<br/>pre-commit hook"]
    ci["CI, every push<br/>typecheck, lint, format,<br/>unit, e2e, image, deploy"]
    citest[("Postgres,<br/>e2e service container")]
    deploy["Deploy<br/>registry, migrate,<br/>then roll the tag"]

    client["Client<br/>browser or mobile"]
    cdn["CDN<br/>TLS ends here"]
    api["API, NestJS<br/>helmet, CORS, policies guard,<br/>throttler with a<br/>per-process counter"]
    pg[("PostgreSQL<br/>a pool of 10 per process, two processes per task,<br/>76 usable, 3 fit, 1 runs")]
    store[("Object storage<br/>product images")]
    smtp["Mail provider<br/>no stored password"]
    stripe["Stripe"]
    valkey[("Valkey<br/>stock queue")]
    worker["Worker<br/>same image,<br/>different entrypoint"]

    code --> ci
    ci --> citest
    ci -.-> deploy
    deploy -.->|"migrations"| pg
    deploy -.->|"then the tag"| api

    client -->|"HTTPS, bearer token"| cdn
    cdn -->|"HTTP, CDN only"| api
    api -->|"reads, writes,<br/>and who liked it"| pg
    api -->|"images"| store
    api -->|"reset and changed mail"| smtp
    api -->|"create intent or link"| stripe
    api -->|"after the commit,<br/>one job per recipient"| valkey
    stripe -->|"signed webhook"| cdn
    valkey --> worker
    worker --> pg
    worker -->|"low-stock mail"| smtp
```

The shared ceiling is Postgres. ADR 35 records what would move it.

## What comes off the request path

One thing is queued: when a variant's stock reaches three, everyone who liked it and has not
bought it gets an email, which is one write and then unbounded calls to a mail provider. The
enqueue waits for the commit, so a mail outage cannot fail a paid order, and retries are per
recipient, because BullMQ is at-least-once and a job dying mid-list resends everything before
it. Three attempts, a second and two apart, then the failed set keeps the id, so that pair is
never told again.

Why BullMQ. Valkey is already provisioned for the throttler's counter once it is shared
across replicas, and one job type does not use what a broker sells. I rejected RabbitMQ:
exchanges, bindings and inter-queue dead-lettering are routing this system has no second
consumer for, and its at-least-once guarantee is the same, so the idempotency work is
identical.

**Switch:** when a second consumer needs the same event under a different routing rule,
RabbitMQ. BullMQ makes each new consumer an edit to the producer; one exchange and two
bindings makes it a deployment.

**Gives up:** a crash between the commit and the enqueue loses the job. The fix I did not
build is a transactional outbox.

## How it deploys

One CloudFormation stack in `infra/`: the image on one arm64 ECS instance behind CloudFront
for HTTPS, a managed Postgres, a managed Valkey, and an object store. Not serverless: a pool
per invocation multiplies connections by concurrency until the database refuses them. The
release, registry then `prisma migrate deploy` as a one-off task then the tag rolled, is a
job per push to `main` that assumes a role through GitHub's OIDC token and stores no key.

**Switch:** a pooler in front of Postgres removes that objection.

Migrations are additive, one early rename aside, and run before the roll, so the old image
reads the new schema. Rollback is the image, rehearsed at three minutes each way. The roll is
not zero downtime: one task, one host port, seconds of 504.

## Where a request fails halfway

The seam is the payment webhook, because Stripe holds half the state. It is the only writer
of `paid`, and stock comes down inside the transaction that sets it, so a disagreement is one
failed transaction, not two drifting systems. The Stripe event id is the primary key of
`stripe_events`, inserted first in that transaction, so a retry is a unique violation. ADR 24
records the rest.

## How I know it still works, and what I would watch

Per route: request rate, 4xx against 5xx, p95 latency, and saturation as pool usage and
event loop lag. Then what no infrastructure metric shows: checkout conversion, webhook lag,
the failed set's size, and stock going negative, which pages. None of these metrics exists
yet. The logs are pino JSON on stdout, ADR 21.

ADR 19 records where the security risks are, and the one setting no test catches.
