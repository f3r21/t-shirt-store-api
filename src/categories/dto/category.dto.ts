import { ApiSchema } from '@nestjs/swagger';
/** The contract's `Category`, read through this shape by both operations. */
@ApiSchema({ name: 'Category' })
export class CategoryDto {
  id!: number;

  name!: string;
}
