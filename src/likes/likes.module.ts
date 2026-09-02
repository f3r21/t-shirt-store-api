import { Module } from '@nestjs/common';
import { LikesService } from './likes.service';
import { LikesController, MyLikesController } from './likes.controller';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [ProductsModule],
  controllers: [LikesController, MyLikesController],
  providers: [LikesService],
})
export class LikesModule {}
