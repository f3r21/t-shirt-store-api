import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { CategoryDto } from '../../categories/dto/category.dto';
import { ProductVariantDto } from '../../variants/dto/product-variant.dto';

/**
 * One image of a product, the contract's `ProductImage`. The array is
 * required, so the key is always present.
 */
@ApiSchema({ name: 'ProductImage' })
export class ProductImageDto {
  id!: number;

  url!: string;

  isPrimary!: boolean;
}

/**
 * The contract's `Product`. The three arrays are required, so a new product
 * carries three empty ones, and `deleted_at` never reaches a response.
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
   * A lazy `type` on the three arrays, because the plugin's own inference
   * explores this class before the ones it points at are registered and
   * reports a circular dependency that does not exist.
   */
  @ApiProperty({ type: () => ProductVariantDto, isArray: true })
  variants!: ProductVariantDto[];

  @ApiProperty({ type: () => ProductImageDto, isArray: true })
  images!: ProductImageDto[];

  @ApiProperty({ type: () => CategoryDto, isArray: true })
  categories!: CategoryDto[];
}
