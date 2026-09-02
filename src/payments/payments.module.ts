import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeGateway } from './stripe.gateway';
import { stripeClientProvider } from './stripe.client';
import { StockNotificationsModule } from '../stock-notifications/stock-notifications.module';

/**
 * The two Stripe flows and the webhook. The SDK instance is a token, so the
 * e2e factory can replace the API calls and keep the signature check; see
 * `stripe.client.ts`. `PrismaModule` and `ConfigModule` are global. The
 * webhook is one of the two stock writers, so the low-stock producer comes in.
 */
@Module({
  imports: [StockNotificationsModule],
  controllers: [PaymentsController],
  providers: [stripeClientProvider, StripeGateway, PaymentsService],
})
export class PaymentsModule {}
