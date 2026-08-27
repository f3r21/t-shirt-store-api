import { CategoryDto } from '../../categories/dto/category.dto';
import { ProductVariantDto } from '../../variants/dto/product-variant.dto';

/**
 * One image of a product. See `openapi.yaml:1867-1879`.
 *
 * The two image operations need object storage and are out of scope this week,
 * so `ProductDto.images` is an empty array until then. The contract makes the
 * array required, so the key is always present.
 */
export class ProductImageDto {
  id!: number;

  url!: string;

  isPrimary!: boolean;
}

/**
 * Response shape of GET /products/{id}, POST /products and PATCH /products/{id}.
 * See `openapi.yaml:1811-1841`.
 *
 * The contract makes `variants`, `images` and `categories` required, so each
 * key is present and holds an array. A new product carries three empty arrays,
 * which is the state `createProduct` leaves it in.
 *
 * The `products` row also holds `deleted_at`. It does not reach a response. The
 * contract answers 404 for a deleted product instead.
 */
export class ProductDto {
  id!: number;

  name!: string;

  /** Absent when the product carries no description. */
  description?: string;

  isActive!: boolean;

  /** ISO 8601. The mapper converts the `Date` the database returns. */
  createdAt!: string;

  variants!: ProductVariantDto[];

  images!: ProductImageDto[];

  categories!: CategoryDto[];
}
