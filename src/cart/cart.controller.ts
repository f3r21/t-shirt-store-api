import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CartService } from './cart.service';
import { CartDto } from './dto/cart.dto';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { SetCartItemDto } from './dto/set-cart-item.dto';
import { CheckPolicies } from '../authz/check-policies.decorator';
import { can } from '../authz/policies';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/access-token-payload';
import { ParseIdPipe } from '../common/parse-id.pipe';

/**
 * The cart of the signed-in user. See `openapi.yaml:1197-1374`.
 *
 * Every signed-in caller may call every operation here: the contract declares
 * no 403 on any of the five, and a manager has a cart for the same reason a
 * client does. The ability grants `manage CartItem` on the caller's own rows,
 * the guard denies by default without a policy, and the rows are the caller's
 * by construction because every read and write takes the user id from the
 * token.
 *
 * Each handler is named after its contract operation id, because the served
 * document names operations from the method and the drift suite compares them.
 */
@ApiTags('cart')
@Controller('users/me/cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @CheckPolicies(can('manage', 'CartItem'))
  @ApiOperation({ summary: 'Get the cart of this user' })
  @ApiResponse({
    status: 200,
    description: 'The cart of this user.',
    type: CartDto,
  })
  @ApiResponse({ status: 401, description: 'The request has no valid token.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Get()
  getCart(@CurrentUser() user: AccessTokenPayload): Promise<CartDto> {
    return this.cart.getCart(user.sub);
  }

  @CheckPolicies(can('manage', 'CartItem'))
  @ApiOperation({ summary: 'Empty the cart' })
  @ApiResponse({ status: 204, description: 'The cart is empty.' })
  @ApiResponse({ status: 401, description: 'The request has no valid token.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  clearCart(@CurrentUser() user: AccessTokenPayload): Promise<void> {
    return this.cart.clearCart(user.sub);
  }

  @CheckPolicies(can('manage', 'CartItem'))
  @ApiOperation({ summary: 'Add a quantity of one variant to the cart' })
  @ApiResponse({
    status: 200,
    description: 'The cart after the line was added.',
    type: CartDto,
  })
  @ApiResponse({ status: 400, description: 'The request body is invalid.' })
  @ApiResponse({ status: 401, description: 'The request has no valid token.' })
  @ApiResponse({
    status: 404,
    description: 'The variant does not exist, or its product is not on sale.',
  })
  @ApiResponse({
    status: 409,
    description: 'The resulting quantity is above the units on hand.',
  })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Post('items')
  @HttpCode(HttpStatus.OK)
  addCartItem(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: AddCartItemDto,
  ): Promise<CartDto> {
    return this.cart.addCartItem(user.sub, dto);
  }

  @CheckPolicies(can('manage', 'CartItem'))
  @ApiOperation({ summary: 'Set the quantity of one variant in the cart' })
  @ApiResponse({
    status: 200,
    description: 'The cart, with this line set.',
    type: CartDto,
  })
  @ApiResponse({ status: 400, description: 'The request body is invalid.' })
  @ApiResponse({ status: 401, description: 'The request has no valid token.' })
  @ApiResponse({
    status: 404,
    description: 'The variant does not exist, or its product is not on sale.',
  })
  @ApiResponse({
    status: 409,
    description: 'The quantity is above the units on hand.',
  })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Put('items/:variantId')
  setCartItem(
    @CurrentUser() user: AccessTokenPayload,
    @Param('variantId', ParseIdPipe) variantId: number,
    @Body() dto: SetCartItemDto,
  ): Promise<CartDto> {
    return this.cart.setCartItem(user.sub, variantId, dto);
  }

  @CheckPolicies(can('manage', 'CartItem'))
  @ApiOperation({ summary: 'Remove one variant from the cart' })
  @ApiResponse({
    status: 204,
    description: 'The cart holds no line for this variant.',
  })
  @ApiResponse({ status: 400, description: 'The id is not an integer.' })
  @ApiResponse({ status: 401, description: 'The request has no valid token.' })
  @ApiResponse({ status: 404, description: 'The variant does not exist.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Delete('items/:variantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCartItem(
    @CurrentUser() user: AccessTokenPayload,
    @Param('variantId', ParseIdPipe) variantId: number,
  ): Promise<void> {
    return this.cart.deleteCartItem(user.sub, variantId);
  }
}
