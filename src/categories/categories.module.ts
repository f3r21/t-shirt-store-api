import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService],
  // ProductsService validates categoryIds through assertAllExist.
  exports: [CategoriesService],
})
export class CategoriesModule {}
