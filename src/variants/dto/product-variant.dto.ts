/**
 * One variant, as `POST /products/{id}/variants`, `PATCH /variants/{id}` and
 * `PATCH /variants/{id}/stock` all return it. See `openapi.yaml:1844-1865`.
 *
 * `size` and `color` are absent when the column holds none. The contract admits
 * no null value, so the mapper omits the key. This is the same rule
 * `SessionDto.deviceName` follows.
 */
export class ProductVariantDto {
  id!: number;

  /** Absent when the variant carries no size. */
  size?: string;

  /** Absent when the variant carries no color. */
  color?: string;

  /**
   * An amount in minor units. 1999 means 19.99. See `openapi.yaml:2143-2149`.
   *
   * The column stores an integer. The ERD gives `numeric(10,2)`, and the
   * contract carries no floating point value, so the schema stores the minor
   * unit instead.
   */
  price!: number;

  /**
   * The units on hand for this variant.
   *
   * The contract states that this API does not treat the number as a secret, at
   * `openapi.yaml:1859-1862`, so the value reaches every caller who can read
   * the variant.
   */
  stock!: number;
}
