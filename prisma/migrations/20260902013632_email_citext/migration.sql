-- citext is a trusted extension since Postgres 13. The schema does not declare it
-- because Prisma manages extensions only behind a preview flag; see DECISIONS 10.
CREATE EXTENSION IF NOT EXISTS citext;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "email" SET DATA TYPE CITEXT;
