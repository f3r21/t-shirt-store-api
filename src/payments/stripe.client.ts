import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { EnvironmentVariables } from '../config/env.validation';

/**
 * The injection token for the Stripe SDK instance.
 *
 * A token rather than the class, for the reason `MAILER` is one: the e2e
 * suite replaces the two API calls with a stub and keeps the signature check
 * real, and a class token would make that replacement replace the check too.
 */
export const STRIPE_CLIENT = Symbol('STRIPE_CLIENT');

/**
 * The three calls this service makes on the SDK, and no more.
 *
 * A real `Stripe` instance satisfies this structurally. A stub has to provide
 * exactly these three, so a spec or the e2e factory cannot forget one and
 * receive `undefined` from a deep mock. `constructEvent` is pure HMAC over the
 * raw body and needs no network, which is why the stub keeps the real one.
 */
export interface StripeClient {
  paymentLinks: {
    create(
      params: Stripe.PaymentLinkCreateParams,
    ): Promise<Stripe.Response<Stripe.PaymentLink>>;
  };
  paymentIntents: {
    create(
      params: Stripe.PaymentIntentCreateParams,
    ): Promise<Stripe.Response<Stripe.PaymentIntent>>;
  };
  webhooks: {
    constructEvent(
      payload: string | Buffer,
      header: string,
      secret: string,
    ): Stripe.Event;
  };
}

/** The production binding: the SDK on the secret key, with its pinned API version. */
export const stripeClientProvider = {
  provide: STRIPE_CLIENT,
  inject: [ConfigService],
  useFactory: (
    config: ConfigService<EnvironmentVariables, true>,
  ): StripeClient => new Stripe(config.getOrThrow<string>('STRIPE_SECRET_KEY')),
};
