# One image, two entry points: the API, and the queue worker that mails the
# low-stock notifications.
#
#   docker build -t t-shirt-store-api .
#   docker run --rm -p 3000:3000 --env-file .env t-shirt-store-api
#   docker run --rm --env-file .env t-shirt-store-api node dist/src/worker.js
#
# The release step is a third target, built from the stage that still holds the Prisma CLI:
#
#   docker build --target migrate -t t-shirt-store-api:migrate .
#   docker run --rm --env-file .env t-shirt-store-api:migrate
#
# Configuration arrives through the process environment. This image ships no .env,
# and env.validation.ts stops the boot when a required variable is missing.
# Migrations do not run here. They are a release step before the new image takes
# traffic, so the Prisma CLI and prisma/migrations stay out of the runtime stage.
ARG NODE_IMAGE=node:22-alpine

# ---- deps: the tree the runtime stage keeps --------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./

# --ignore-scripts is load-bearing, not hardening. npm runs `prepare` after
# `npm ci`, `prepare` is `husky`, and husky is a devDependency, so --omit=dev
# deletes the command that prepare then calls and the shell exits 127. HUSKY=0
# cannot rescue it: husky reads that variable inside the package just omitted.
# The production closure has one native dependency, argon2, which resolves its
# musl prebuild at require time rather than through an install script.
RUN npm ci --omit=dev --ignore-scripts

# ---- build: generate the client, then compile ------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV HUSKY=0
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src

# `nest build` runs `prisma generate` first, through prebuild, and the Prisma CLI
# reads DATABASE_URL even when it only generates. Nothing connects at build time.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN npm run build

# RDS refuses a plaintext connection, and the driver verifies the server against this
# bundle when DATABASE_SSL_CA names it (src/prisma/database-ssl.ts). Fetched here once and
# copied to the runtime stage, so both entrypoints and the release step carry it.
RUN wget -qO /app/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

# ---- migrate: the release step -------------------------------------------
# `prisma migrate deploy` needs the CLI and prisma/migrations, which the runtime stage leaves
# behind on purpose, so the step is this stage with one command: the build stage, run once as
# a one-off task before a new tag takes traffic (infra/stack.yml, MigrateTaskDefinition). The
# build-time DATABASE_URL is emptied here, so a run that forgot to pass one fails at once
# rather than dialling the placeholder.
FROM build AS migrate
ENV DATABASE_URL=""
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- runtime ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist/src ./dist/src
COPY --from=build /app/rds-global-bundle.pem ./rds-global-bundle.pem
COPY package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
