/**
 * One entry of GET /categories, and one entry of `Product.categories`.
 *
 * See `openapi.yaml:1892-1900`. The contract names two fields. The
 * `categories` table is read through this shape by both operations, so a
 * column added later does not reach a response by accident.
 */
export class CategoryDto {
  id!: number;

  name!: string;
}
