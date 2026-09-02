import { Module } from '@nestjs/common';
import { VariantsService } from './variants.service';
import {
  ProductVariantsController,
  VariantsController,
} from './variants.controller';
import { StockNotificationsModule } from '../stock-notifications/stock-notifications.module';

/** The stock count is the second stock writer, so the producer comes in. */
@Module({
  imports: [StockNotificationsModule],
  controllers: [ProductVariantsController, VariantsController],
  providers: [VariantsService],
})
export class VariantsModule {}
