# T-Shirt Store API

A store API built on NestJS, Prisma and PostgreSQL. It is the capstone of RAVN's NodeJS
programme, and it answers to a hand-written OpenAPI contract that was designed in week 2.

**The contract is authoritative.** It lives at
`../BE-Nerdery-Challenges/5-api-design/openapi.yaml`. Where this code and that document
disagree, the document is right and the code is wrong.

## Run it

Four commands, in this order. Two of them carry a trap, noted below.

```bash
npm install
cp .env.example .env      # then fill in the two blank secrets, see below
npm run docker:up         # Postgres, Redis and Mailpit
npm run db:migrate        # applies the migrations
npm run db:seed           # NOT optional, see below
npm run start:dev
```

The API is then on `http://localhost:3000/v1`. Mailpit's web interface, where every message
this API sends can be read, is on `http://localhost:8025`.

**Postgres is published on 5433, not 5432.** The compose file avoids a clash with a
container from week 1 of the programme. A default `DATABASE_URL` gets connection refused.
`.env.example` already carries the right one.

**The seed is a hard prerequisite, not a convenience.** `users.role_id` is not null and the
service reads the role out of the `roles` table, so sign-up fails with "The roles table
holds no client role. Run the seed." until `db:seed` has run.

### The two secrets

`.env.example` fills in every value except two, which are blank because they are secrets.
Both need at least 32 characters:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- `JWT_SECRET` signs the access token.
- `REFRESH_TOKEN_PEPPER` keys the hash of the refresh and reset tokens. It is deliberately
  a separate value: rotating the signing key would otherwise invalidate every stored token
  hash at the same moment.

## Check it

```bash
npm run typecheck    # tsc --noEmit
npm test             # jest
npm run lint         # eslint --fix
```

`npm run typecheck` is worth running after any schema change. **A green typecheck is not
evidence that the generated Prisma client matches the schema**: every file under
`src/generated/` carries `// @ts-nocheck` and the directory is ignored by ESLint. Run
`npm run db:generate` after editing `prisma/schema.prisma`.

## What is implemented

| Area | State |
|---|---|
| Sign up, sign in, sign out | Done, with unit tests |
| Refresh token rotation and reuse detection | Done, with unit tests |
| Device session list, per-device sign out | Done, with unit tests |
| Forgot password, reset password, change password | Done, with unit tests |
| Mail on password change and password reset | Done, delivered through Mailpit locally |
| RFC 9457 problem documents on every error | Done |
| Helmet, CORS, environment schema validation | Done |
| Rate limiting | Done, on the three operations the contract declares a 429 for |
| Products, variants, categories | Done, with unit tests |
| Three-way product visibility, soft delete, manager-only writes | Done, with unit tests |
| End-to-end tests | Done for the authentication flow, against a real database |
| Cart, orders, order history | Not started |
| CASL authorization | Not started. `RolesGuard` holds the seam, and the role claim it needs is already in the token |
| Stripe, the notification queue, S3 uploads | Not started. See `ARCHITECTURE.md` for the queue rationale |

The unit suite is 129 tests over the authentication, user and catalog surfaces, and the
end-to-end suite is 20 more against a real database. Neither has a placeholder entry left.
What is untested is what is unwritten.

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
7 days, stored only as a keyed hash, and it rotates on every use. Rotation updates one row
in place, so a session keeps its id and a client can sign one device out by that id.

**Reuse detection.** The previous hash is retained for one generation. A refresh token
presented twice means the server is holding a stolen one, so it deletes every refresh row
for that user and each device must sign in again.

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
  hash is not argon2, why rotation cannot fix the two-tab race, why sign-in carries no rate
  limit, and what each of those cost.
- `../BE-Nerdery-Challenges/5-api-design/DECISIONS.md` records the contract's design.
- `../BE-Nerdery-Challenges/4-database/3-erd/DECISIONS.md` records the data model's.

## Known gaps

Stated here rather than discovered later. The longer list, with the reasoning, is in
`DECISIONS.md`.

- `POST /auth/forgot-password` answers identically for a known and an unknown address, but
  the two paths do not take the same time. The endpoint is rate limited instead.
- Two browser tabs refreshing in the same moment can trip reuse detection and sign the user
  out of every device, with no attacker involved. This follows the contract literally and is
  at one end of the industry range.
- The rate limit counter is in process memory. Correct for one instance, wrong for two.
- Email addresses are folded to lower case in the service. The durable form is a unique
  index on `lower(email)`, which is not yet written.
