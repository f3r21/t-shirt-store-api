import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

/**
 * The cart, five operations over `cart_items`. `PrismaModule` is global, so
 * nothing is imported here.
 */
@Module({
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}
