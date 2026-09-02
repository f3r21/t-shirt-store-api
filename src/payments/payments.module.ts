import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeGateway } from './stripe.gateway';
import { stripeClientProvider } from './stripe.client';

/**
 * The two Stripe flows and the webhook. The SDK instance is a token, so the
 * e2e factory can replace the API calls and keep the signature check; see
 * `stripe.client.ts`. `PrismaModule` and `ConfigModule` are global.
 */
@Module({
  controllers: [PaymentsController],
  providers: [stripeClientProvider, StripeGateway, PaymentsService],
})
export class PaymentsModule {}
