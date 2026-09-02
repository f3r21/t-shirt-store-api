import { IsInt, Max, Min } from 'class-validator';
import { INT4_MAX } from '../../common/int4';

/**
 * Request body of POST /payment-links. See `openapi.yaml:1605-1622`.
 *
 * The contract declares both fields required and gives `quantity` a default
 * of 1 for readers; the server takes the contract's `required` at its word
 * and asks for both, so the two documents agree on the shape.
 */
export class CreatePaymentLinkDto {
  @IsInt({ message: 'must be an integer' })
  @Min(1, { message: 'must be at least 1' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  variantId!: number;

  @IsInt({ message: 'must be an integer' })
  @Min(1, { message: 'must be at least 1' })
  @Max(INT4_MAX, { message: 'must be at most 2147483647' })
  quantity!: number;
}
