/*
  Warnings:

  - You are about to drop the column `reset_token` on the `users` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[reset_token_hash]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "reset_token",
ADD COLUMN     "reset_token_hash" TEXT;

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_previous_token_hash_idx" ON "refresh_tokens"("previous_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "users_reset_token_hash_key" ON "users"("reset_token_hash");
