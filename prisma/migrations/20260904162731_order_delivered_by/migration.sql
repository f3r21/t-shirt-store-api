-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivered_by_user_id" INTEGER;

-- CreateIndex
CREATE INDEX "orders_delivered_by_user_id_created_at_id_idx" ON "orders"("delivered_by_user_id", "created_at", "id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivered_by_user_id_fkey" FOREIGN KEY ("delivered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
