-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "discount_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "promo_code" TEXT,
ADD COLUMN     "promo_code_id" INTEGER;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
