# T-Shirt Store API

A store API on NestJS, Prisma and PostgreSQL, built to a hand-written OpenAPI contract.

It is the capstone of RAVN's NodeJS programme. The contract at `contract/openapi.yaml` is
authoritative, and `contract/README.md` says where it came from and why it lives here.

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

The API is then on `http://localhost:3000/v1`. Mailpit's web interface at
`http://localhost:8025` shows every message the API and the worker send.

The worker is a second process. It consumes the low-stock queue and sends the mails from the
same image as the API, so a slow mail provider never holds a request. Without it the jobs
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

`.env.example` names every variable the schema declares, and `src/app.module.spec.ts` fails
if one is missing. Eight variables are blank and four of them need a value:

- `JWT_SECRET` and `REFRESH_TOKEN_PEPPER`, at least 32 characters each. The boot refuses
  without them. The pepper is a separate value so that rotating the signing key keeps every
  stored token hash valid. ADR 1.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, from the Stripe section below.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`S3_BUCKET` and `IMAGES_BASE_URL` carry placeholders, so the API boots with no AWS account.
Only the image upload needs the real values, the `ImagesBucket` and `ApiUrl` outputs of the
deployed stack. An upload against a placeholder fails at S3 with a 500, and never at boot.
To upload an image, set the two variables to those outputs. The AWS SDK reads its credentials
from the shell, `AWS_PROFILE=tshirt npm run start:dev`, never from a file.

The other four stay blank on a laptop. An empty `CORS_ORIGINS` means no browser on another
origin may call the service. `SMTP_USER` and `SMTP_PASS` stay empty because Mailpit wants no
credentials, and the mailer sends none unless both are set. `DATABASE_SSL_CA` stays empty
because the compose container speaks no TLS. The deployed task sets `MAIL_TRANSPORT` to
`ses`, which reads no `SMTP_*` and sends from the task role, and points `DATABASE_SSL_CA` at
the RDS bundle in the image. `REDIS_URL` is filled in and required: the queue opens it at
boot, and the compose file's Valkey answers it.

### Stripe

Payments run in Stripe test mode. `STRIPE_SECRET_KEY` is the `sk_test_` key from the Stripe
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

The intent accepts every payment method the dashboard enables, and some of them redirect, so
Stripe refuses a confirm with no return URL. The value is never visited for a card.

The end-to-end suite never reaches Stripe. It replaces the two API calls with a stub and
signs its own events with the same secret the server verifies, so the signature check is the
production code path.

In production the endpoint is the distribution's URL,
`https://daat4q77vztp7.cloudfront.net/v1/webhooks/stripe`, added in the Stripe dashboard in
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
The pre-push hook runs the end-to-end suite, so it needs the database from
`npm run docker:up`. Add `--no-verify` to skip either hook.

`docs:lint` needs Vale on the machine (`brew install vale`) and, once, `vale sync` to fetch
the two style packages into `.vale/styles`. The rules are in `.vale.ini`. The project's own
terms are in `.vale/styles/config/vocabularies` and its own rules in `.vale/styles/TShirtStore`.

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

Every push to `main` is a release, once the checks pass. The `deploy` job in
`.github/workflows/ci.yml` builds both images on an arm runner, pushes them tagged with the
commit, points the migrate task at the commit, runs the migrations, rolls the service, and
proves the running task carries the tag of that commit. No key is stored in GitHub: the run's
OIDC token assumes `tshirt-deploy`, a role `infra/ci.yml` creates, and the stack is changed
through `tshirt-cloudformation`, a role only CloudFormation can assume. The one-time setup is
that template as the stack `tshirt-ci`, and its two outputs as the repository variables
`AWS_DEPLOY_ROLE_ARN` and `AWS_STACK_ROLE_ARN`. ADR 30 says why this shape.

The first deploy, and a rescue when the job cannot run, is the same release from a laptop.
From a clean checkout, with `<sha>` as the short commit id:

1. Create the stack with the service at zero:
   `aws cloudformation deploy --profile tshirt --region us-east-2 --stack-name tshirt --template-file infra/stack.yml --capabilities CAPABILITY_IAM --parameter-overrides DbPassword="$(openssl rand -hex 16)" MailFrom=<your address> DesiredCount=0`
2. Build the two images: `docker build -t api .` and `docker build --target migrate -t migrate .`
3. Tag them `<ecr>:<sha>` and `<ecr>:<sha>-migrate`, log in with
   `aws ecr get-login-password`, and push both. The ECR address is a stack output.
4. Point the migrate task at the tag: the deploy command again, with
   `--parameter-overrides MigrateImageTag=<sha>`.
5. Run the migrations once:
   `aws ecs run-task --profile tshirt --region us-east-2 --cluster tshirt --task-definition tshirt-migrate --launch-type EC2`
6. Seed the roles once, with the same command and
   `--overrides '{"containerOverrides":[{"name":"migrate","command":["node","dist/prisma/seed.js"]}]}'`.
   Add `"environment":[{"name":"SEED_MANAGER_EMAIL","value":"<email>"}]` inside the override to
   make an existing account the manager; the demo accounts never reach a deployed database.
7. Start the service: the deploy command again, with
   `--parameter-overrides ImageTag=<sha> DesiredCount=1`.

To restore the previous release, run the deploy command with the tag of the previous commit.
Then wait for the service:

```bash
aws cloudformation deploy --profile tshirt --region us-east-2 --stack-name tshirt --template-file infra/stack.yml --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset --parameter-overrides ImageTag=<previous sha>
aws ecs wait services-stable --profile tshirt --region us-east-2 --cluster tshirt --services tshirt-app
```

Then read the running task's image back, as the deploy job does in its last step. Two
mechanisms exist. A task that never becomes healthy returns to the previous task definition
on its own, through the service's circuit breaker. A release that became healthy and is wrong
needs that command. Rehearsed on 2026-09-03: about three minutes each way, proven by the
running tag. Leave `MigrateImageTag` where it is: a migration is never reversed, so
the previous image must read the current schema, and so every migration is additive
(the known gaps below name the one that was not).

Mail and Stripe, once, after the first release:

1. Verify the sender:
   `aws sesv2 create-email-identity --profile tshirt --region us-east-2 --email-identity <your address>`,
   then open the link in the mail AWS sends.
2. Replace the two Stripe placeholders: the `put-parameter` command of the five secrets, with `--overwrite`,
   `/tshirt/STRIPE_SECRET_KEY` with the `sk_test_` key and `/tshirt/STRIPE_WEBHOOK_SECRET` with
   the signing secret of the endpoint from the Stripe section.
3. Switch the transport: the deploy command again, with
   `--parameter-overrides MailTransport=ses MailFrom=<your address>`. That roll also reads the
   two new secrets.

The API answers at the `ApiUrl` stack output. The review instance is
`https://daat4q77vztp7.cloudfront.net/v1`: sign up there, and the operator's seed override
makes one account the manager. Tear everything down in two commands: empty the images bucket
first, because CloudFormation refuses to delete a bucket that holds objects, then delete the
stack, and the trust with the same command on `tshirt-ci`:

```bash
aws s3 rm "s3://$(aws cloudformation describe-stacks --profile tshirt --region us-east-2 --stack-name tshirt --query "Stacks[0].Outputs[?OutputKey=='ImagesBucket'].OutputValue" --output text)" --recursive --profile tshirt --region us-east-2
aws cloudformation delete-stack --profile tshirt --region us-east-2 --stack-name tshirt
```

It costs about 31 USD a month plus storage at the prices of 2026-09-02, the figure ADR 29
records, and the account's credits carry that for the review.

## What is implemented

| Area | State |
|---|---|
| Sign up, sign in, sign out | Done, with unit tests |
| Refresh token rotation and reuse detection | Done, with unit tests |
| Device session list, per-device sign out | Done, with unit tests |
| Forgot password, reset password, change password | Done, with unit tests |
| Mail on password change and password reset | Done, through Mailpit locally and through SES from the task role in production |
| RFC 9457 problem documents on every error | Done |
| Structured JSON logs with a request id | Done, through pino. Every line carries the id, and no line carries a token |
| Helmet, CORS, environment schema validation | Done |
| Rate limiting | Done, in three tiers: browsing, sign-in, and the three password operations |
| Products, variants, categories | Done, with unit tests |
| Three-way product visibility, soft delete, manager-only writes | Done, with unit tests |
| Cart | Done, five operations: a live view priced now, a stock check before every write, and only products on sale |
| Orders | Done, five operations: placed from the cart in one transaction, the status flow as one table, a cancel after payment giving the units back, and the history with its five filters |
| Delivery person, Optional Features 11 and 12 | Done, one operation and one status: `GET /deliveries` lists the shipped orders to deliver, and the same list under `status=delivered` is the caller's own delivery history. The role sends `delivered` on a shipped order and nothing else, and the server records who delivered it. A client reads the full status history of its own order, as before |
| Payments | Done, both Stripe flows: a payment link for one product and a payment intent for a cart, and one webhook that verifies the signature over the raw body, marks the order paid once, and lowers the stock. The deployed endpoint receives Stripe's own test-mode events through the distribution |
| Promo codes, Optional Feature 13 | Done, both halves. A manager creates a code, reads one page of codes with the number of orders each has been used on, and disables or enables one. A client sends `promoCode` in the body of `POST /orders`. The server checks the four rules the brief lists and answers 422 with its own problem type for each one. A percentage rounds down and a fixed amount stops at the subtotal, so a total is never negative. The code column is `citext`, so `SAVE10` and `save10` are one code: the second create answers 409 and a buyer may type either. The use is counted inside the checkout transaction, guarded on the limit, so two checkouts racing for the last use place one order. The order keeps the code and the discount, and a later change to the code does not reach it. See ADR 37 |
| Likes | Done, three operations: like and unlike a variant, idempotent on the primary key, and the liked products as one page in the product list's shape |
| Images | Done, two operations: an upload sniffed by its bytes with a 5 MiB limit, stored in S3 under a random key and served through CloudFront, one primary per product; a delete that removes the row and then the object |
| End-to-end tests | Done, in sixteen suites against a real database and a real Valkey: liveness and the kernel's headers, authentication, the cart, catalog authorization, catalog reads, checkout through a signed Stripe event to the stock decrement and the status flow, deliveries for two delivery people, a client and a manager, product images with the store in memory, likes, the served OpenAPI document against the contract, order history for two clients and a manager, the promo codes a manager creates and disables, a code applied at checkout with its four refusals and a ten-trial race for the last use, rate limits, roles, and the low-stock notifications through the real queue and worker to the mail |
| CASL authorization | Done. An ability per caller, a policy on every handler, deny by default, and the ownership conditions turned into the where clauses the services read with |
| Stock notifications | Done. When a write takes a variant's stock from more than 3 to 3 or fewer, one BullMQ job per liker who has not bought it lands after the commit, from the webhook and from the manager's stock count alike, and a worker in its own process mails each person once, with the product's image, retrying a failed send. See `ARCHITECTURE.md` for the queue rationale |
| Deploy | Done. One CloudFormation stack, ECS on one instance behind CloudFront, a managed database, and a managed cache; every push to `main` releases through a job that assumes a role by OIDC, with no key stored |

The unit suite covers the authentication, user and catalog surfaces, and the end-to-end suite
runs against a real database. Neither has a placeholder entry left. What is untested is what
is unwritten. The counts are in the summary line of each run:

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

## Where the reasoning lives

- `ARCHITECTURE.md`, in this repository, is the production shape: the diagram, why the
  notification is queue-backed, the deploy shape, and what would be monitored.
- `docs/decisions/`, in this repository, holds one record per implementation choice: the
  context, the options, the decision, and what it gives up. `docs/decisions/README.md` is
  the index. Tokens and sessions are ADR 1 to 4, problem documents ADR 11, money as an
  integer ADR 13, and 404 for another client's row ADR 25.
- `contract/README.md` says where the contract came from and why it lives here.
- `../BE-Nerdery-Challenges/5-api-design/DECISIONS.md` records the contract's design.
- `../BE-Nerdery-Challenges/4-database/3-erd/DECISIONS.md` records the data model's.

## Known gaps

- `POST /auth/forgot-password` answers identically for a known and an unknown address, but
  the two paths do not take the same time. The endpoint is rate limited instead. Sign-in
  closed the same gap by running one argon2 verify on the unknown-address path.
- A failed mail send does not fail the request. Both mailing operations change the password
  first and mail afterwards, so an error would make the caller retry with a password that
  no longer works. The failure is logged.
- The argon2 parameters are the library defaults, which exceed the current OWASP row. They
  are not stated at the call sites.
- Inside the grace window a stolen previous-generation token is accepted without raising the
  alarm, up to ten rows per spent token at the defaults. `REFRESH_GRACE_SECONDS` is the dial
  and 0 turns it off.
- The rate limit counter is in process memory. Correct for one instance, wrong for two.
- Production mail goes through SES in its sandbox. Only verified addresses receive until AWS
  grants production access: the request is `aws sesv2 put-account-details`, answered in
  about a day. The mails land in spam, because the sender is a personal address SES cannot
  sign for. A domain with DKIM fixes that.

- The liveness route reaches no database, so a task that boots against an incompatible
  schema passes the circuit breaker. The additive-migration rule is discipline, not a check.
  Seven of the eight migrations are additive. The second drops `users.reset_token` in the same
  statement that adds `reset_token_hash`, so a replica still on the previous image breaks
  mid-rollout. That rename needed expand and contract.
- Every link sale logs `payment.orphan` for its `payment_intent.succeeded` event, because the
  link's intent carries no order id (ADR 24). The warning is real only for an intent this
  service did not create.

## License

UNLICENSED. Coursework for RAVN's NodeJS programme, not for distribution.
