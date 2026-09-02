import { ApiSchema } from '@nestjs/swagger';

/**
 * Response shape of POST /payment-links. See `openapi.yaml:2252-2270`.
 *
 * `expiresAt` is declared optional by the contract and never sent: a Stripe
 * payment link has no expiry, it is deactivated instead, and inventing a
 * date would be a promise Stripe does not keep.
 */
@ApiSchema({ name: 'PaymentLink' })
export class PaymentLinkDto {
  /** The order this link pays for. It starts in `pending`. */
  orderId!: number;

  /** The Stripe page that takes the payment. Send the buyer to this page. */
  url!: string;

  /** When Stripe stops accepting this link. Absent: a link does not expire. */
  expiresAt?: string;
}
