import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { CategoryDto } from '../../categories/dto/category.dto';
import { ProductVariantDto } from '../../variants/dto/product-variant.dto';

/**
 * One image of a product. See `openapi.yaml:2021-2033`.
 *
 * The table exists since migration `20260829023040` and the detail read maps
 * it, primary first. Nothing writes it until `uploadProductImage` lands, which
 * needs object storage and is Week 4 work, so a product created through the API
 * carries an empty array. The contract makes the array required, so the key is
 * always present.
 */
@ApiSchema({ name: 'ProductImage' })
export class ProductImageDto {
  id!: number;

  url!: string;

  isPrimary!: boolean;
}

/**
 * Response shape of GET /products/{id}, POST /products and PATCH /products/{id}.
 * See `openapi.yaml:1822-1852`.
 *
 * The contract makes `variants`, `images` and `categories` required, so each
 * key is present and holds an array. A new product carries three empty arrays,
 * which is the state `createProduct` leaves it in.
 *
 * The `products` row also holds `deleted_at`. It does not reach a response. The
 * contract answers 404 for a deleted product instead.
 */
@ApiSchema({ name: 'Product' })
export class ProductDto {
  id!: number;

  name!: string;

  /** Absent when the product carries no description. */
  description?: string;

  isActive!: boolean;

  /** ISO 8601. The mapper converts the `Date` the database returns. */
  createdAt!: string;

  /**
   * The three composite arrays carry an explicit `@ApiProperty` with a lazy
   * `type`, and that is not decoration. The Swagger compiler plugin infers a
   * lazy resolver of its own for a class-valued property, and when the document
   * is built it explores `ProductDto` before the classes it points at are
   * registered, then reports a circular dependency that does not exist:
   * `ProductVariantDto` imports nothing. Naming the type here resolves it at the
   * point of use rather than by inference, so the document builds the same way
   * under `nest build` and under the test runner.
   */
  @ApiProperty({ type: () => ProductVariantDto, isArray: true })
  variants!: ProductVariantDto[];

  @ApiProperty({ type: () => ProductImageDto, isArray: true })
  images!: ProductImageDto[];

  @ApiProperty({ type: () => CategoryDto, isArray: true })
  categories!: CategoryDto[];
}
