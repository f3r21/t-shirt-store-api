import { ApiSchema } from '@nestjs/swagger';
/**
 * The `meta` half of every collection envelope. See `openapi.yaml:1734-1753`.
 *
 * No endpoint returns a bare array, so every list response carries `data` and
 * this shape together.
 */
@ApiSchema({ name: 'PageMeta' })
export class PageMetaDto {
  /** Rows that match the filter, before `limit` and `offset` apply. */
  total!: number;

  /** Rows in this page. The request's `limit` sets it. */
  limit!: number;

  /** Rows the server skipped. */
  offset!: number;
}
