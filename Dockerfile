# One image, two entry points: the API today, and the queue worker once it exists.
#
#   docker build -t t-shirt-store-api .
#   docker run --rm -p 3000:3000 --env-file .env t-shirt-store-api
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

# ---- runtime ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist/src ./dist/src
COPY package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
