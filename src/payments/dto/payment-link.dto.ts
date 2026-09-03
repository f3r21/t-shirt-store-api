import { ApiSchema } from '@nestjs/swagger';

/**
 * The contract's `PaymentLink`. `expiresAt` is declared optional and never
 * sent: a Stripe link is deactivated, not expired.
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
