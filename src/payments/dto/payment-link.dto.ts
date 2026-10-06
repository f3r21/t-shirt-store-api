import { ApiSchema } from '@nestjs/swagger';

/**
 * The contract's `PaymentLink`. It carries no expiry, because a Stripe Payment
 * Link has none: it stays payable until it is deactivated.
 */
@ApiSchema({ name: 'PaymentLink' })
export class PaymentLinkDto {
  /** The order this link pays for. It starts in `pending`. */
  orderId!: number;

  /**
   * A Stripe Payment Link. Send the buyer to this page. Stripe's page does not
   * redirect back: read `GET /orders/{orderId}`, whose `status` turns `paid`
   * when the `checkout.session.completed` webhook arrives. The link does not
   * expire, and Stripe accepts more than one payment on it. Only the first
   * payment moves the order to `paid`.
   */
  url!: string;
}
