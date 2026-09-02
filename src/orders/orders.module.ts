import { Module } from '@nestjs/common';
import { MyOrdersController, OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/**
 * Orders, five operations over `orders`, `order_items` and
 * `order_status_history`. `PrismaModule` is global, so nothing is imported.
 */
@Module({
  controllers: [OrdersController, MyOrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
