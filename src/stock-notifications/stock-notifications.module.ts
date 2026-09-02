import { Module } from '@nestjs/common';
import { stockQueueProvider } from './stock-queue';
import { LowStockProducer } from './low-stock.producer';

/**
 * The low-stock notifications, producer side. Imported by the two modules
 * that write stock, payments and variants. `PrismaModule` and `ConfigModule`
 * are global. The worker is a separate entrypoint and its own module.
 */
@Module({
  providers: [stockQueueProvider, LowStockProducer],
  exports: [LowStockProducer],
})
export class StockNotificationsModule {}
