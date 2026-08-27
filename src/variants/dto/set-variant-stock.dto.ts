import { IsInt, Min } from 'class-validator';

/**
 * Request body of PATCH /variants/{id}/stock. See `openapi.yaml:1085-1097`.
 *
 * The stock has its own operation and its own body, because the payment webhook
 * writes the same column.
 */
export class SetVariantStockDto {
  /** The units on hand after this call. */
  @IsInt({ message: 'must be an integer' })
  @Min(0, { message: 'must be at least 0' })
  stock!: number;
}
