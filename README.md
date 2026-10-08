# T-Shirt Store API

[![CI](https://github.com/f3r21/t-shirt-store-api/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/f3r21/t-shirt-store-api/actions/workflows/ci.yml?query=branch%3Amain)

A store API on NestJS, Prisma and PostgreSQL, built to a hand-written OpenAPI contract.

It is the capstone of RAVN's NodeJS programme. The contract at `contract/openapi.yaml` is
authoritative, and `contract/README.md` says where it came from and why it lives here.

A deployed instance answers at `https://d1hfx5i8kcs8ag.cloudfront.net/v1` until 2026-10-23,
with Swagger UI at `https://d1hfx5i8kcs8ag.cloudfront.net/docs`. Payments there run in Stripe
test mode. The "Known limitations" section at the end says what it runs and what it cannot
do, and the "Deploy" section says how it comes down.

## Buy a t-shirt on the deployed instance

No setup and no Stripe account. Set `BASE=https://d1hfx5i8kcs8ag.cloudfront.net/v1`.

1. `POST $BASE/users` with `email`, `password` (8 to 128 characters), `firstName` and `lastName`.
2. `POST $BASE/auth/sessions` with the same `email` and `password`. Send its `accessToken` as
   `Authorization: Bearer <token>` from here on. It lasts 15 minutes, and
   `POST $BASE/auth/refresh` with `{"refreshToken": "<refreshToken>"}` renews both tokens.
3. `GET $BASE/products`, then `GET $BASE/products/{id}`. Pick a `variants[].id` whose `stock`
   is 1 or more.
4. `POST $BASE/payment-links` with `{"variantId": <id>, "quantity": 1}`. The 201 carries
   `orderId` and `url`, and the order starts `pending`.
5. Open `url`. It is Stripe's test-mode page. Pay with the card `4242 4242 4242 4242`, any
   future date, any CVC and any name. Stripe may offer your local currency first. Choose USD,
   the currency the store charges and the one every test payment so far has used. The page
   ends at "Thanks for your payment" and does not return to the store.
6. `GET $BASE/orders/{orderId}`. `status` turns `paid` once Stripe's webhook arrives, within
   seconds. Pay each link once: "Known limitations" says what a second payment does.

The cart flow (`POST /orders`, then `POST /orders/{id}/payments`) returns a client secret for
Stripe.js and needs a frontend. From a terminal or Swagger, pay with the payment link.

## Run it

Seven commands, in this order. Three of them carry a trap, noted below.

```bash
npm install
cp .env.example .env      # then fill in the four blank values, see below
npm run docker:up         # Postgres, Valkey and Mailpit
npm run db:migrate        # applies the migrations
npm run db:seed           # NOT optional, see below
npm run start:dev
npm run start:worker:dev  # in a second terminal, see below
```

The API is then on `http://localhost:3000/v1`. Swagger UI at `http://localhost:3000/docs`,
outside the `/v1` prefix, shows the document generated from the controllers, and
`test/openapi-contract.e2e-spec.ts` fails when it drifts from the contract. Mailpit's web
interface at `http://localhost:8025` shows every message the API and the worker send.

The worker is a second process. It consumes the low-stock queue and sends the low-stock mails
from the same image as the API, so a slow mail provider never holds a checkout or a stock
write. The password mails still go out inside their own request. Without the worker the jobs
wait in Valkey and nothing is lost.

Postgres is published on 5433. The compose file avoids a clash with the week 1 container, so
a default `DATABASE_URL` gets connection refused. `.env.example` carries the right one.

The seed is a hard prerequisite. `users.role_id` is not null and the service reads the role
from the `roles` table, so sign-up fails with "The roles table holds no client role. Run the
seed." until `db:seed` has run.

The seed also creates three demo accounts, so a reviewer can sign in as a manager without
editing the database. All three use the password `Password123!`:

    manager@tshirt.store   creates and edits products and variants
    client@tshirt.store    everything a customer can reach
    delivery@tshirt.store  reads the shipped orders and marks them delivered

They are development fixtures with a published password. `prisma/seed.ts` refuses to create
them when `NODE_ENV` is `production`, and seeds only the roles and categories there.

### The environment file

`.env.example` names every variable and explains each one, and `src/app.module.spec.ts` fails
if one is missing. Four blank values need yours:

- `JWT_SECRET` and `REFRESH_TOKEN_PEPPER`, 32 characters or more. The boot refuses without
  them. The pepper is separate, so rotating the signing key keeps every stored token hash
  valid. ADR 1.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, from the Stripe section below.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`S3_BUCKET` and `IMAGES_BASE_URL` carry placeholders, so the API boots with no AWS account.
An upload against a placeholder fails at S3 with a 500, and never at boot. To upload an
image, set the two variables to the `ImagesBucket` and `ApiUrl` outputs of the deployed
stack, then start with `AWS_PROFILE=tshirt npm run start:dev`. The AWS SDK reads its
credentials from the shell, never from a file.

### Stripe

This section is for a local run. On the deployed instance, pay through the payment link, as
the "Buy a t-shirt on the deployed instance" section shows. `stripe payment_intents confirm`
works only with the Stripe account that holds the store's keys.

Payments run in Stripe test mode. Stripe always enables Adaptive Pricing on Payment Links, so
the payment link page may offer the buyer's local currency, PEN from Peru for one, next to
USD. The store charges USD. `STRIPE_SECRET_KEY` is the `sk_test_` key from the Stripe
dashboard. `STRIPE_WEBHOOK_SECRET` comes from the `stripe` command-line tool, which also
forwards events to the running API:

```bash
stripe login
stripe listen --forward-to localhost:3000/v1/webhooks/stripe   # prints whsec_..., paste it into .env
```

To pay an order without a browser, create a payment intent through the API, then confirm it
with a test card. The tool prints the `payment_intent.succeeded` event as it forwards it, and
the order turns `paid` with its stock lowered:

```bash
stripe payment_intents confirm pi_... --payment-method pm_card_visa --return-url https://example.com/return
```

The intent accepts cards only (`payment_method_types: ['card']` in
`src/payments/stripe.gateway.ts`, ADR 24). The return URL is never visited for a card.

The end-to-end suite never reaches Stripe. It replaces the two API calls with a stub and
signs its own events with the same secret the server verifies, so the signature check is the
production code path.

In production the endpoint is the distribution's URL followed by `/v1/webhooks/stripe` (on
the deployed instance, `https://d1hfx5i8kcs8ag.cloudfront.net/v1/webhooks/stripe`), added in
the Stripe dashboard in
test mode for `checkout.session.completed` and `payment_intent.succeeded`. Its signing secret
and the `sk_test_` key replace the two placeholders in SSM, in the Deploy section below, and
the tasks read them at their next start. The distribution forwards the body and the
`stripe-signature` header unchanged, so the same check runs there.

## Check it

```bash
npm run typecheck    # tsc --noEmit
npm test             # jest, unit
npm run test:e2e     # jest, against a real database
npm run lint:ci      # eslint, reports and changes nothing
npm run format:check # prettier, reports and changes nothing
npm run docs:lint    # vale, the pages and the decision records, reports and changes nothing
npm audit --omit=dev --audit-level=high   # the dependency tree the image ships
```

`lint:ci` and `format:check` are the read-only pair, and they are what CI runs. `npm run lint`
and `npm run format` carry `--fix` and `--write`, so they edit the tree. Use those to change
the tree and the read-only pair to check it.

Two git hooks run the same checks before the code leaves the machine. The pre-commit hook
runs the lint and format fixes on the staged files, then the type checker and the unit suite.
The pre-push hook runs the end-to-end suite against `tshirt_store_test`, so it needs the
containers from `npm run docker:up` and that database, created and migrated as the end of
the "What is implemented" section shows. Add `--no-verify` to skip either hook.

`docs:lint` needs Vale 3.19.0, the version the Prose job pins; `brew install vale` installs a
later one. Download it from https://github.com/vale-cli/vale/releases/tag/v3.19.0, and run
`vale sync` once to fetch the two style packages into `.vale/styles`. The rules are in
`.vale.ini`. The project's own terms are in `.vale/styles/config/vocabularies` and its own
rules in `.vale/styles/TShirtStore`.

A green typecheck does not prove that the generated Prisma client matches the schema: every
file under `src/generated/` carries `// @ts-nocheck`, and ESLint ignores the directory. Run
`npm run db:generate` after editing `prisma/schema.prisma`.

## Deploy

One environment, one template. `infra/stack.yml` describes ECS on one arm64 instance behind
CloudFront for HTTPS, an RDS Postgres 16 database, an ElastiCache Valkey 9 node, an ECR
repository and the images bucket. The AWS profile is `tshirt` in `us-east-2`. ADR 29 says
why this shape. Nothing under `infra/` holds a secret.

Write the five secrets the tasks read once, before the first deploy. Each command has the
same shape:

```bash
aws ssm put-parameter --profile tshirt --region us-east-2 --type SecureString --name /tshirt/JWT_SECRET --value "$(openssl rand -hex 32)"
```

The five names are `JWT_SECRET`, `REFRESH_TOKEN_PEPPER`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET` and `SMTP_PASS`, which only the `smtp` transport reads.

Every push to `main` is a release, once the checks pass and the repository variable
`DEPLOY_ENABLED` is `true`. With the variable unset, a push runs the checks and deploys nothing,
which keeps a torn-down stack down. The `deploy` job in
`.github/workflows/ci.yml` builds both images, pushes them tagged with the commit, runs the
migrations, rolls the service, and proves the running task carries that tag. No key is stored
in GitHub: the run's OIDC token assumes `tshirt-deploy`, and the stack is changed through
`tshirt-cloudformation`, a role only CloudFormation can assume. `infra/ci.yml` creates both,
as the stack `tshirt-ci`, and its two outputs are the repository variables
`AWS_DEPLOY_ROLE_ARN` and `AWS_STACK_ROLE_ARN`. ADR 30 says why this shape.

The first deploy, and a rescue when the job cannot run, is the same release from a laptop.
This is the deploy command, and every step below runs it again with other overrides:

```bash
aws cloudformation deploy --profile tshirt --region us-east-2 --stack-name tshirt --template-file infra/stack.yml --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset --parameter-overrides <overrides>
```

From a clean checkout, with `<sha>` as the short commit id:

1. `DbPassword="$(openssl rand -hex 16)" MailFrom=<your address> DesiredCount=0`, which
   creates the stack with the service stopped.
2. `docker build -t api .` and `docker build --target migrate -t migrate .`, then tag both
   `<ecr>:<sha>` and `<ecr>:<sha>-migrate` and push. The ECR address is a stack output.
3. `MigrateImageTag=<sha>`, then run the migrations:
   `aws ecs run-task --profile tshirt --region us-east-2 --cluster tshirt --task-definition tshirt-migrate --launch-type EC2`
4. The same run-task with
   `--overrides '{"containerOverrides":[{"name":"migrate","command":["node","dist/prisma/seed.js"]}]}'`,
   which seeds the roles. Add `"environment":[{"name":"SEED_MANAGER_EMAIL","value":"<email>"}]`
   to make an existing account the manager.
5. `ImageTag=<sha> DesiredCount=1`, which starts the service.

To restore the previous release, run the deploy command with `ImageTag=<previous sha>`, then
wait for the service:

```bash
aws ecs wait services-stable --profile tshirt --region us-east-2 --cluster tshirt --services tshirt-app
```

Then read the running task's image back, as the deploy job does in its last step. Two
mechanisms cover two failures. A task that never becomes healthy returns to the previous task
definition on its own, through the service's circuit breaker. A release that became healthy
and is wrong needs that command. Rehearsed on 2026-09-03: about three minutes each way,
proven by the running tag. Leave `MigrateImageTag` where it is, because a migration is never
reversed, so the previous image must read the current schema. The known gaps below name the
two migrations that broke that rule.

Mail and Stripe, once, after the first release:

1. Verify the sender:
   `aws sesv2 create-email-identity --profile tshirt --region us-east-2 --email-identity <your address>`,
   then open the link AWS sends.
2. Replace the two Stripe placeholders by running the `put-parameter` command again with
   `--overwrite`, for `/tshirt/STRIPE_SECRET_KEY` and `/tshirt/STRIPE_WEBHOOK_SECRET`.
3. Switch the transport: the deploy command, with
   `--parameter-overrides MailTransport=ses MailFrom=<your address>`. That roll also reads the
   two new secrets.

The API answers at the `ApiUrl` stack output. The deployed instance,
`https://d1hfx5i8kcs8ag.cloudfront.net/v1`, runs the image of the last merge to `main` released
while `DEPLOY_ENABLED` was set, on 2026-10-06. The variable is unset again, so later merges
change nothing that runs, and the instance comes down on 2026-10-23. The first review
instance, `https://daat4q77vztp7.cloudfront.net`, was torn down on 2026-09-14.

Tear everything down in four commands. Empty the images bucket first, because CloudFormation
refuses to delete a bucket that holds objects. Then delete the stack and wait for it, because
a stack the deploy job changed is deleted through `tshirt-cloudformation`, the role the trust
holds. Then delete the trust:

```bash
aws s3 rm "s3://$(aws cloudformation describe-stacks --profile tshirt --region us-east-2 --stack-name tshirt --query "Stacks[0].Outputs[?OutputKey=='ImagesBucket'].OutputValue" --output text)" --recursive --profile tshirt --region us-east-2
aws cloudformation delete-stack --profile tshirt --region us-east-2 --stack-name tshirt
aws cloudformation wait stack-delete-complete --profile tshirt --region us-east-2 --stack-name tshirt
aws cloudformation delete-stack --profile tshirt --region us-east-2 --stack-name tshirt-ci
```

It costs about 31 USD a month plus storage at the prices of 2026-09-02, the figure ADR 29
records, and the account's credits carry it while the stack is up.

## What is implemented

| Area | State |
|---|---|
| Sign up, sign in, sign out | Done, unit tested |
| Refresh token rotation and reuse detection | Done, unit tested. ADR 1 to 4 |
| Device session list, per-device sign out | Done, unit tested |
| Forgot password, reset password, change password | Done, unit tested |
| Mail on password change and password reset | Done. Mailpit locally, SES in production |
| RFC 9457 problem documents on every error | Done. ADR 11 |
| Structured JSON logs with a request id | Done, through pino. No line carries a token. ADR 21 |
| Helmet, CORS, environment schema validation | Done |
| Rate limiting | Done, in three tiers: browsing, sign-in, and the three password operations. ADR 7 |
| Products, variants, categories | Done, unit tested |
| Three-way product visibility, soft delete, manager-only writes | Done, unit tested. ADR 15 and 16 |
| Cart | Done, unit tested. Five operations, priced live and stock checked before every write. ADR 22 |
| Orders | Done, unit tested. Five operations, placed from the cart in one transaction, with a history and its five filters. ADR 23 |
| Delivery person, Optional Features 11 and 12 | Done. `GET /deliveries` lists the shipped orders, and the role sends `delivered` and nothing else |
| Payments | Done, unit tested. Both Stripe flows, the payment link and the payment intent. One webhook verifies the signature over the raw body and is the only writer of `paid`. ADR 24 |
| Promo codes, Optional Feature 13 | Done, unit tested. Both halves, with a `citext` code and the use counted inside the checkout transaction. ADR 37 |
| Likes | Done, unit tested. Three operations, idempotent on the primary key. ADR 26 |
| Images | Done, unit tested. Sniffed by their bytes, stored in S3 under a random key, served through CloudFront |
| End-to-end tests | Done, eighteen suites against a real database and a real Valkey |
| CASL authorization | Done. Deny by default, and the ownership conditions become the where clauses the services read with. ADR 25 |
| Stock notifications | Done, unit tested. One queued job per liker on a crossing to 3 or fewer, mailed by a worker in its own process. ADR 27 |
| Deploy | Done. One CloudFormation stack, and every push to `main` releases by OIDC with no key stored, while `DEPLOY_ENABLED` is `true`. ADR 29 and 30 |

The unit suite covers every feature module, and the end-to-end suite runs against a real
database. `docs/qa/test-map.md` says what each suite proves and does not. Neither has a
placeholder entry left. What is untested is what is unwritten. The counts are in the summary
line of each run:

```bash
npm test          # unit
npm run test:e2e  # needs a tshirt_store_test database, see below
```

The end-to-end suite runs against its own database, because it truncates between tests and
doing that to the development database would delete the seed on every run:

```bash
docker compose exec -T postgres psql -U postgres -c 'CREATE DATABASE tshirt_store_test'
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/tshirt_store_test npx prisma migrate deploy
```

## Product, design and QA

- [`docs/product.md`](docs/product.md): who the API is for, what was built and cut, and
  whether it is ready for production.
- [`docs/design.md`](docs/design.md): what a client shows for each status and problem type,
  the order's states, and how to pay: the cart flow, which needs Stripe.js, and the
  payment-link flow, which pays on Stripe's hosted page with no frontend.
- [`docs/qa/`](docs/qa/): the [test plan](docs/qa/test-plan.md) with its entry and exit
  criteria, the [risk register](docs/qa/risk-register.md), and a [map](docs/qa/test-map.md)
  of what each suite proves and does not prove.
- [`docs/research/friction-log.md`](docs/research/friction-log.md): the protocol for one
  interview on 2026-10-07 that tested the user assumption, with P3, a front-end developer. The
  results are in "Validated by" in [`docs/product.md`](docs/product.md).

## Where the reasoning lives

- `ARCHITECTURE.md`, in this repository, is the production shape: the diagram, why the
  notification is queue-backed, the deploy shape, and what would be monitored.
- `docs/decisions/`, in this repository, holds one record per implementation choice: the
  context, the options, the decision, and what it gives up. `docs/decisions/README.md` is
  the index. Tokens and sessions are ADR 1 to 4, problem documents ADR 11, money as an
  integer ADR 13, and 404 for another client's row ADR 25.
- `contract/README.md` says where the contract came from and why it lives here.
- [`5-api-design/DECISIONS.md`](https://github.com/f3r21/BE-Nerdery-Challenges/blob/aedfe45/5-api-design/DECISIONS.md), in BE-Nerdery-Challenges,
  records the contract's design.
- [`4-database/3-erd/DECISIONS.md`](https://github.com/f3r21/BE-Nerdery-Challenges/blob/aedfe45/4-database/3-erd/DECISIONS.md), in the same
  repository, records the data model's.
- `docs/ai-module/writeup.md` is the AI module: the two project skills, `investigate-task`
  and `verify-fix`, the session-expiry fix they produced, and the runs in
  `docs/ai-module/evidence/`.

## Known gaps

- `POST /auth/forgot-password` answers identically for a known and an unknown address, but
  the two paths do not take the same time. The endpoint is rate limited instead. Sign-in
  closed the same gap by running one argon2 hash on the unknown-address path.
- A failed mail send does not fail the request. Both mailing operations change the password
  first and mail afterwards, so an error would make the caller retry with a password that
  no longer works. The failure is logged.
- The argon2 parameters are the library defaults, which exceed the current OWASP row. They
  are not stated at the call sites.
- Inside the grace window a stolen previous-generation token is accepted without raising the
  alarm, up to ten rows per spent token at the defaults. `REFRESH_GRACE_SECONDS` is the dial
  and 0 turns it off.
- The rate limit counter is in process memory. Correct for one instance, wrong for two.
- Production mail goes through SES in its sandbox, so only verified addresses receive. The
  request for production access was denied, case 178837643400798, so the sandbox limits
  stand: 200 messages in 24 hours, one per second. The mails land in spam, because the
  sender is a personal address SES cannot sign for. A domain with DKIM fixes the spam, and
  it is also the change that would make a second production request defensible.
- The liveness route reaches no database, so a task that boots against an incompatible
  schema passes the circuit breaker. The additive-migration rule is discipline, not a check.
  Nine of the eleven migrations are additive and two are not. The second drops
  `users.reset_token` in the same statement that adds `reset_token_hash`, so a replica still
  on the previous image breaks mid-rollout. That rename needed expand and contract. The
  eighth changes `users.email` to `citext`, which rewrites the table under an ACCESS
  EXCLUSIVE lock, so a rolling deploy waits on it.
- A `payment.orphan` warning has two causes and the line does not say which. An intent that
  carries no order id is a link sale, which is expected: the `payment_intent.succeeded` event
  of a link sale carries no order id (ADR 24). The order is paid from
  `checkout.session.completed`, which does carry it. An intent that names an order id no row
  matches is not expected, and the deployed service logged three of those on 2026-09-07, for
  orders 2 and 3. The order rows
  were gone by the time the event arrived. Only the second kind is worth an alert, and the
  log line needs to separate them before one can be written.

## Known limitations

What a newcomer meets that the other sections do not say.

The deployed store:

- It answers until 2026-10-23, then the stack is deleted and only "Run it" reaches the API.
  The bare host answers 404, so start at `/docs` or `/v1`.
- It runs the image of the last merge to `main` released while `DEPLOY_ENABLED` was set, on
  2026-10-06. The variable is unset again, so later merges change nothing that runs.
- It holds no demo account, because the seed skips them when `NODE_ENV` is `production`.
  `POST /v1/users` makes you a client. The manager and delivery-person operations need "Run
  it" and the demo accounts.
- Pay with a payment link, as the "Buy a t-shirt on the deployed instance" section shows. An
  intent from `POST /v1/orders/{id}/payments` can be confirmed only from the store's own
  Stripe account.
- A payment link stays payable after its order is paid. `POST /v1/payment-links` returns a
  reusable Stripe Payment Link (`buy.stripe.com`), not a single-use Checkout Session, and the
  API neither limits it to one completed session nor deactivates it when the order turns
  `paid`. Opening the same URL again shows a fresh form, and Stripe takes the money again
  behind the same "Thanks for your payment" page. The store records none of it: no second
  order, no change to the first, no stock change, because the webhook's conditional `pending`
  to `paid` write finds nothing to move (ADR 24). No operation refunds, so the extra charge has
  to be found and refunded in the Stripe Dashboard. The same happens when a second person
  pays a shared link. Setting `restrictions.completed_sessions.limit` to 1 on the link is
  Stripe's documented way to make it single use.
- The access token lasts 15 minutes: `JWT_ACCESS_TTL` defaults to 900 seconds and the stack
  does not change it. After that a call answers 401 with the `access-token-expired` problem
  type, so a slow session needs `POST /v1/auth/refresh` with `{"refreshToken": "<token>"}`,
  which returns a new pair.
- SES is in its sandbox with one verified sender, so mail reaches verified addresses only,
  and lands in spam there. `POST /v1/auth/forgot-password` answers 202, but its reset mail
  never reaches your address, so a password reset cannot be finished here.
- No browser origin is allowed (`CORS_ORIGINS` is not set in `infra/stack.yml`), so a front
  end on another origin is refused.
- The rate limit is per address: 100 requests a minute on most routes, 10 sign-ins, sign-ups
  or refreshes a minute, and 5 password operations in 15 minutes (ADR 7). Past it the answer
  is 429 with `Retry-After`.

On your machine:

- "Run it" needs Node 22 (`.nvmrc`), Docker, a Stripe account in test mode and the `stripe`
  command-line tool.
- The seed creates no product. Sign in as `manager@tshirt.store` and create a product, a
  variant and its stock before the cart can take a line.
- An image upload answers 500 until `S3_BUCKET` and `IMAGES_BASE_URL` name a real bucket.
- The pre-push hook runs the end-to-end suite against `tshirt_store_test`, so create and
  migrate that database once before the first `git push`. `npm run check:db` migrates it and
  runs the suite in one command.
- `npm run docs:lint` needs Vale 3.19.0, the version CI pins. `brew install vale` installs a
  later one, and CI records 3.22.0 failing a file that 3.19.0 passes.
- `ARCHITECTURE.md` is at 648 words against a ceiling of 650, so an edit that adds words
  fails the `Prose` job.
- `npm install` reports moderate advisories, 2 of them in the production tree (`js-yaml`
  through `@nestjs/swagger`). CI fails on high and critical only.
- The problem `type` identifiers under `https://tshirt.store/problems/` name a problem and do not
  resolve.

## License

UNLICENSED. Coursework for RAVN's NodeJS programme, not for distribution.
