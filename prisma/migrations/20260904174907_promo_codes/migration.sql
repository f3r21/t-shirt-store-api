-- CreateEnum
CREATE TYPE "promo_discount_type" AS ENUM ('percentage', 'fixed');

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" SERIAL NOT NULL,
    "code" CITEXT NOT NULL,
    "discount_type" "promo_discount_type" NOT NULL,
    "discount_value" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "usage_limit" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "min_purchase_cents" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");
