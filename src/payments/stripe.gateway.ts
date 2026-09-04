import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';
import type { EnvironmentVariables } from '../config/env.validation';
import { STRIPE_CLIENT } from './stripe.client';
import type { StripeClient } from './stripe.client';

/** The store is single-currency, and the contract says which one. */
const CURRENCY = 'usd';

/**
 * The smallest amount Stripe will collect in this currency, in minor units.
 *
 * A rule of the currency and not of an order, which is why it lives beside
 * `CURRENCY`: the reference for `POST /v1/payment_intents` gives `amount` as a
 * positive integer and states "The minimum amount is $0.50 US or equivalent in
 * charge currency". Read by `PaymentsService`, which refuses a smaller total
 * rather than sending an amount the API answers with an error nothing maps.
 * The day the store sells in a second currency this becomes a lookup by
 * currency. ADR 37.
 */
export const STRIPE_MINIMUM_CENTS = 50;

/**
 * Stripe's shapes in, this service's shapes out, so nothing else sees a
 * Stripe object and the e2e stub answers three methods. A payment link takes
 * inline `price_data`, and its `metadata` is copied to every Checkout Session
 * it creates, which is how the webhook finds the order.
 */
@Injectable()
export class StripeGateway {
  private readonly logger = new Logger(StripeGateway.name);
  private readonly webhookSecret: string;

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: StripeClient,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.webhookSecret = config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');
  }

  /**
   * A shareable page that sells one line. The order id rides in the link's
   * metadata and comes back on `checkout.session.completed`.
   */
  async createPaymentLink(input: {
    orderId: number;
    name: string;
    unitAmount: number;
    quantity: number;
  }): Promise<{ url: string }> {
    const link = await this.stripe.paymentLinks.create({
      line_items: [
        {
          price_data: {
            currency: CURRENCY,
            unit_amount: input.unitAmount,
            product_data: { name: input.name },
          },
          quantity: input.quantity,
        },
      ],
      metadata: { orderId: String(input.orderId) },
      // Card only, in code: a delayed method needs
      // `checkout.session.async_payment_succeeded` handled first, and the
      // dashboard alone must not be able to enable one. ADR 24.
      payment_method_types: ['card'],
    });
    return { url: link.url };
  }

  /**
   * One payment attempt for an order. The amount is the order's, never a
   * caller's, and the order id rides in the metadata that comes back on
   * `payment_intent.succeeded`.
   */
  async createPaymentIntent(input: {
    orderId: number;
    amount: number;
  }): Promise<{ clientSecret: string }> {
    const intent = await this.stripe.paymentIntents.create({
      amount: input.amount,
      currency: CURRENCY,
      metadata: { orderId: String(input.orderId) },
      payment_method_types: ['card'],
    });
    if (intent.client_secret === null) {
      throw new Error(
        'Stripe answered a payment intent with no client secret.',
      );
    }
    return { clientSecret: intent.client_secret };
  }

  /**
   * Verify the signature over the raw bytes and parse the event, or 400.
   *
   * The raw body and not the parsed one, because the signature covers the
   * bytes Stripe sent and a re-serialised body would not match them. A missing
   * body, a missing header and a failed check are one answer, so a caller
   * cannot tell which half was wrong.
   */
  parseEvent(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Stripe.Event {
    if (rawBody === undefined || signature === undefined) {
      throw this.badSignature();
    }
    try {
      return this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch {
      throw this.badSignature();
    }
  }

  private badSignature(): BadRequestException {
    this.logger.warn({
      msg: 'stripe signature rejected',
      event: 'payment.signature-rejected',
    });
    return new BadRequestException({
      title: 'Validation failed',
      detail: 'The Stripe-Signature header does not verify against the body.',
    });
  }
}
