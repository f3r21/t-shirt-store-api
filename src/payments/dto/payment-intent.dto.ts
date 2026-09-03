import { ApiSchema } from '@nestjs/swagger';

/** The contract's `PaymentIntent`. */
@ApiSchema({ name: 'PaymentIntent' })
export class PaymentIntentDto {
  orderId!: number;

  /**
   * Stripe.js completes the payment with this value. It is not a server
   * credential; it identifies one payment attempt.
   */
  clientSecret!: string;

  /**
   * The amount Stripe will charge, in minor units. It comes from the order,
   * so a client cannot choose what to pay.
   */
  amount!: number;
}
