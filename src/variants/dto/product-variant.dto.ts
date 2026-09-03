import { ApiSchema } from '@nestjs/swagger';
/** The contract's `ProductVariant`. `size` and `color` are absent when the column holds none. */
@ApiSchema({ name: 'ProductVariant' })
export class ProductVariantDto {
  id!: number;

  /** Absent when the variant carries no size. */
  size?: string;

  /** Absent when the variant carries no color. */
  color?: string;

  /** Minor units, so 1999 means 19.99. ADR 13. */
  price!: number;

  /** The units on hand. The contract does not treat the number as a secret. */
  stock!: number;
}
