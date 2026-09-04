import { Module } from '@nestjs/common';
import { PromoCodesService } from './promo-codes.service';
import { PromoCodesController } from './promo-codes.controller';

/** The manager's three promo code operations, Optional Feature 13. */
@Module({
  controllers: [PromoCodesController],
  providers: [PromoCodesService],
})
export class PromoCodesModule {}
