# T-Shirt Store API

A store API built on NestJS, Prisma, and PostgreSQL. It is the capstone of RAVN's NodeJS
programme, and it answers to a hand-written OpenAPI contract that was designed in week 2.

**The contract is authoritative.** It lives at
`contract/openapi.yaml`. Where this code and that document
disagree, the document is right and the code is wrong.

## Run it

Seven commands, in this order. Two of them carry a trap, noted below.

```bash
npm install
cp .env.example .env      # then fill in the four blank secrets, see below
npm run docker:up         # Postgres, Redis and Mailpit
npm run db:migrate        # applies the migrations
npm run db:seed           # NOT optional, see below
npm run start:dev
npm run start:worker:dev  # in a second terminal, see below
```

The API is then on `http://localhost:3000/v1`. Mailpit's web interface, where every message
the API and the worker send can be read, is on `http://localhost:8025`.

**The worker is a second process, not a flag.** It consumes the low-stock queue and sends the
mails, from the same code and the same image as the API, so the two scale apart and a slow mail
provider never holds a request. Without it the jobs wait in Redis and nothing is lost.

**Postgres is published on 5433, not 5432.** The compose file avoids a clash with a
container from week 1 of the programme. A default `DATABASE_URL` gets connection refused.
`.env.example` already carries the right one.

**The seed is a hard prerequisite, not a convenience.** `users.role_id` is not null and the
service reads the role out of the `roles` table, so sign-up fails with "The roles table
holds no client role. Run the seed." until `db:seed` has run.

The seed also creates two demo accounts, so a reviewer can sign in as a manager without promoting
a row by hand. Both use the password `Password123!`:

    manager@tshirt.store   creates and edits products and variants
    client@tshirt.store    everything a customer can reach

They are development fixtures with a published password. `prisma/seed.ts` refuses to create them
when `NODE_ENV` is `production`, and seeds only the roles and categories there.

### The two secrets

`.env.example` names every variable the schema declares, and
`src/app.module.spec.ts` fails if one is missing rather than leaving that sentence to rot.

Ten are blank and six of them need a value. `S3_BUCKET` and `IMAGES_BASE_URL` are the
`ImagesBucket` and `ApiUrl` outputs of the deployed stack, and the credentials for the AWS SDK
come from the shell, `AWS_PROFILE=tshirt npm run start:dev`, never from a file. `JWT_SECRET` and `REFRESH_TOKEN_PEPPER` are
blank because they are secrets and the boot refuses without them. `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET` are blank for the same reason, and the next section says where they come
from. `CORS_ORIGINS` is blank because empty is its real default and it means no cross-origin
browser may call this service. `SMTP_USER` and `SMTP_PASS` are blank because Mailpit wants no
credentials, and the mailer sends none unless both are set. `MAIL_TRANSPORT` is `smtp` here and
`ses` in the deployed task, which then reads no `SMTP_*` at all and sends from the task role.
`DATABASE_SSL_CA` is blank because
the compose container speaks no TLS; the deployed task points it at the RDS certificate bundle
the image carries. `REDIS_URL` is filled in and required: the stock notification queue opens it
at boot, and the compose file's Redis answers it.

Only the two signing secrets need at least 32 characters:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- `JWT_SECRET` signs the access token.
- `REFRESH_TOKEN_PEPPER` keys the hash of the refresh and reset tokens. It is deliberately
  a separate value: rotating the signing key would otherwise invalidate every stored token
  hash at the same moment.

### Stripe

Payments run in Stripe test mode. `STRIPE_SECRET_KEY` is the `sk_test_` key from the Stripe
dashboard. `STRIPE_WEBHOOK_SECRET` comes from the `stripe` command-line tool, which also forwards
events to the running API:

```bash
stripe login
stripe listen --forward-to localhost:3000/v1/webhooks/stripe   # prints whsec_..., paste it into .env
```

To pay an order without a browser, create a payment intent through the API, then confirm it with a
test card. The tool prints the `payment_intent.succeeded` event as it forwards it, and the order
turns `paid` with its stock lowered:

```bash
stripe payment_intents confirm pi_...   --payment-method pm_card_visa
```

The end-to-end suite never reaches Stripe. It replaces the two API calls with a stub and signs
its own events with the same secret the server verifies, so the signature check is the production
code path.

In production the endpoint is the distribution's URL,
`https://daat4q77vztp7.cloudfront.net/v1/webhooks/stripe`, added in the Stripe dashboard in test
mode for `checkout.session.completed` and `payment_intent.succeeded`. Its signing secret and the
`sk_test_` key replace the two placeholders in SSM, in the Deploy section below, and the tasks
read them at their next start. The distribution forwards the body and the `stripe-signature`
header unchanged, so the same check runs there.

## Check it

```bash
npm run typecheck    # tsc --noEmit
npm test             # jest, unit
npm run test:e2e     # jest, against a real database
npm run lint:ci      # eslint, reports and changes nothing
npm run format:check # prettier, reports and changes nothing
npm run docs:lint    # vale, this file and ARCHITECTURE.md, reports and changes nothing
npm audit --omit=dev --audit-level=high   # the dependency tree the image ships
```

`lint:ci` and `format:check` are the read-only pair, and they are what CI runs. `npm run lint`
and `npm run format` exist too and carry `--fix` and `--write`, so they edit the tree. Reach for
those when you mean to change something, not when you mean to check it.

Two git hooks run the same checks before the code leaves the machine. The pre-commit hook
runs the lint and format fixes on the staged files, then the type checker and the unit suite.
The pre-push hook runs the end-to-end suite, so it needs the database from
`npm run docker:up`. Add `--no-verify` to skip either hook.

`docs:lint` needs Vale on the machine (`brew install vale`) and, once, `vale sync` to fetch the
Google style into `.vale/styles`. The rules it applies and the ones it deliberately does not are
in `.vale.ini`; the project's own terms are in `.vale/styles/config/vocabularies`.

`npm run typecheck` is worth running after any schema change. **A green typecheck is not
evidence that the generated Prisma client matches the schema**: every file under
`src/generated/` carries `// @ts-nocheck` and the directory is ignored by ESLint. Run
`npm run db:generate` after editing `prisma/schema.prisma`.

## Deploy

One environment, one template. `infra/stack.yml` describes ECS on one arm64 instance behind
CloudFront for HTTPS, an RDS Postgres 16 database, an ElastiCache Valkey 9 node, an ECR repository
and the images bucket. The AWS profile is `tshirt` in `us-east-2`. DECISIONS 29 says why this
shape. Nothing under `infra/` holds a secret.

Write the five secrets the tasks read once, before the first deploy. Each command has the same
shape:

```bash
aws ssm put-parameter --profile tshirt --region us-east-2 --type SecureString --name /tshirt/JWT_SECRET --value "$(openssl rand -hex 32)"
```

The five names are `JWT_SECRET`, `REFRESH_TOKEN_PEPPER`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET` and `SMTP_PASS`, which only the `smtp` transport reads.

**Every push to `feat/week-3-auth` or `main` is a release**, once the checks pass. The `deploy`
job in `.github/workflows/ci.yml` builds both images on an arm runner, pushes them tagged with
the commit, points the migrate task at the commit, runs the migrations, rolls the service, and
proves the running task carries the tag of that commit. No key is stored in GitHub: the run's OIDC
token assumes `tshirt-deploy`, a role `infra/ci.yml` creates, and the stack is changed through
`tshirt-cloudformation`, a role only CloudFormation can assume. The one-time setup is that
template as the stack `tshirt-ci`, and its two outputs as the repository variables
`AWS_DEPLOY_ROLE_ARN` and `AWS_STACK_ROLE_ARN`. DECISIONS 30 says why this shape.

The first deploy, and a rescue when the job cannot run, is the same release by hand. From a
clean checkout, with `<sha>` as the short commit id:

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

SES starts in its sandbox. Only verified addresses receive until AWS grants production access,
which is one command, `aws sesv2 put-account-details`, answered in about a day.

The API answers at the `ApiUrl` stack output. The review instance is
`https://daat4q77vztp7.cloudfront.net/v1`: sign up there, and the operator's seed override
makes one account the manager. Tear everything down with
`aws cloudformation delete-stack --profile tshirt --region us-east-2 --stack-name tshirt`, and
the trust with the same command on `tshirt-ci`.

It costs about 33 USD a month at the prices of 2026-09-02, from the four pricing lines DECISIONS
29 records, and the account's credits carry that for the review.

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
| Orders | Done, five operations: placed from the cart in one transaction, the status flow as one table, and the history with its five filters |
| Payments | Done, both Stripe flows: a payment link for one product and a payment intent for a cart, and one webhook that verifies the signature over the raw body, marks the order paid once, and lowers the stock. The deployed endpoint receives Stripe's own test-mode events through the distribution |
| Likes | Done, three operations: like and unlike a variant, idempotent on the primary key, and the liked products as one page in the product list's shape |
| Images | Done, two operations: an upload sniffed by its bytes with a 5 MiB limit, stored in S3 under a random key and served through CloudFront, one primary per product; a delete that removes the row and then the object |
| End-to-end tests | Done, in thirteen suites against a real database and a real Redis: authentication, catalog reads, catalog authorization, the cart, checkout through a signed Stripe event to the stock decrement, the status flow, order history for two clients and a manager, likes, the low-stock notifications through the real queue and worker to the mail, product images with the store in memory, roles, rate limits, the kernel's headers, and the served OpenAPI document against the contract |
| CASL authorization | Done. An ability per caller, a policy on every handler, deny by default, and the ownership conditions turned into the where clauses the services read with |
| Stock notifications | Done. When a write takes a variant's stock from more than 3 to 3 or fewer, one BullMQ job per liker who has not bought it lands after the commit, from the webhook and from the manager's stock count alike, and a worker in its own process mails each person once, with the product's image, retrying a failed send. See `ARCHITECTURE.md` for the queue rationale |
| Deploy | Done. One CloudFormation stack, ECS on one instance behind CloudFront, a managed database, and a managed cache; every push to the branch releases through a job that assumes a role by OIDC, with no key stored |

The unit suite covers the authentication, user and catalog surfaces, and the end-to-end suite runs
against a real database. Neither has a placeholder entry left. What is untested is what is
unwritten.

Two counts are deliberately absent from that paragraph. They went stale twice, and the second time
a reviewer found them before I did, so the numbers now live where they cannot rot: run
`npm test` and `npm run test:e2e` and read the summary line.

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

## How it works, in five paragraphs

**Tokens.** The access token is a JWT valid for 15 minutes, carrying the user id, the role,
and the id of the device's session. The refresh token is an opaque random string valid for
7 days, stored only as a keyed hash, and it rotates on every use. Rotation updates the row
in place. A device's session is a family of rows named by its founding row, so two tabs
refreshing in the same moment each get a live token, and the session id a client signs out
by is the family's and does not change.

**Reuse detection.** Every spent hash is recorded for the life of the absolute cap. A
refresh token presented again after a ten second grace window means the server is holding a
stolen one, so it deletes every refresh row for that user and the records with them, and
each device must sign in again. Inside the window it is a second tab and gets a live token
of its own. A family's records die with it, so a token from a device that signed out ends
nothing else.

**403 protects an action, 404 protects a fact.** A caller who lacks the role for an
operation gets 403. A caller who asks for a row belonging to somebody else gets 404, because
an integer id is guessable and a 403 would confirm the row exists.

**Errors are problem documents**, `application/problem+json` per RFC 9457, with a `type`
URI only on the failures a status code cannot tell apart. A 404 and a 429 deliberately carry
no type.

**Money is an integer in minor units** on the wire, so 1999 means 19.99. That is what Stripe
speaks and it is what a JSON float cannot represent exactly.

## Where the reasoning lives

- `ARCHITECTURE.md`, in this repository, is the production shape: the diagram, why the
  notification is queue-backed, the deploy shape, and what would be monitored.
- `DECISIONS.md`, in this repository, records the implementation choices: why the token
  hash is not argon2, why a device is a family of tokens with a grace window over rotation,
  why sign-in carries a tighter rate limit than browsing and a looser one than a password
  change, and what each of those cost.
- `contract/README.md` says where the contract came from and why it lives here.
- `../BE-Nerdery-Challenges/5-api-design/DECISIONS.md` records the contract's design.
- `../BE-Nerdery-Challenges/4-database/3-erd/DECISIONS.md` records the data model's.

## Known gaps

Stated here rather than discovered later. The longer list, with the reasoning, is in
`DECISIONS.md`.

- `POST /auth/forgot-password` answers identically for a known and an unknown address, but
  the two paths do not take the same time. The endpoint is rate limited instead.
- Inside the grace window a stolen previous-generation token is accepted without raising the
  alarm, up to ten rows per spent token at the defaults. `REFRESH_GRACE_SECONDS` is the dial
  and 0 turns it off.
- The rate limit counter is in process memory. Correct for one instance, wrong for two.
- Production mail goes through SES in its sandbox. Only verified addresses receive until AWS
  grants production access, which takes about a day from the request. The mails land in spam,
  because the sender is a personal address SES cannot sign for. A domain with DKIM fixes that.
