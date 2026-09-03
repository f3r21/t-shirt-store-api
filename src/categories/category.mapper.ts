import type { Category as CategoryRow } from '../generated/prisma/client';
import type { CategoryDto } from './dto/category.dto';

/** Map a `categories` row to the response shape. */
export function toCategoryDto(row: CategoryRow): CategoryDto {
  return { id: row.id, name: row.name };
}
