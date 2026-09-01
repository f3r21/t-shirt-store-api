import { ApiSchema } from '@nestjs/swagger';
/**
 * One entry of GET /products. See `openapi.yaml:1789-1819`.
 *
 * The entries carry no variants. The contract states that a caller asks for one
 * product to get them, so the server runs a fixed number of queries as the page
 * grows.
 */
@ApiSchema({ name: 'ProductSummary' })
export class ProductSummaryDto {
  id!: number;

  name!: string;

  /**
   * The lowest price among the variants of this product, in minor units.
   *
   * The key is absent when the product has no variant, which is the state
   * `createProduct` leaves it in. The absent case is the normal one here and
   * not an edge case. The contract admits no null value, so the mapper omits
   * the key.
   */
  priceFrom?: number;

  /** Absent when the product has no image. */
  primaryImageUrl?: string;

  /**
   * A disabled product carries false. Only a manager sees a disabled product in
   * a list.
   */
  isActive!: boolean;

  /** ISO 8601. The mapper converts the `Date` the database returns. */
  createdAt!: string;
}
