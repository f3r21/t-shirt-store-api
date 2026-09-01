-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "family_id" INTEGER;

-- CreateTable
CREATE TABLE "consumed_refresh_tokens" (
    "token_hash" TEXT NOT NULL,
    "family_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "consumed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumed_refresh_tokens_pkey" PRIMARY KEY ("token_hash")
);

-- CreateIndex
CREATE INDEX "consumed_refresh_tokens_family_id_idx" ON "consumed_refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "consumed_refresh_tokens_user_id_idx" ON "consumed_refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- AddForeignKey
ALTER TABLE "consumed_refresh_tokens" ADD CONSTRAINT "consumed_refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
