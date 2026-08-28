import { Module } from '@nestjs/common';
import { VariantsService } from './variants.service';
import {
  ProductVariantsController,
  VariantsController,
} from './variants.controller';

@Module({
  controllers: [ProductVariantsController, VariantsController],
  providers: [VariantsService],
})
export class VariantsModule {}
