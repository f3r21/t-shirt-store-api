import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { OrdersService } from './orders.service';
import { OrderDto } from './dto/order.dto';
import { OrderSummaryDto } from './dto/order-summary.dto';
import { OrderHistoryQueryDto } from './dto/order-history-query.dto';
import { ListAllOrdersQueryDto } from './dto/list-all-orders-query.dto';
import { SetOrderStatusDto } from './dto/set-order-status.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/access-token-payload';
import { ROLE_NAMES } from '../users/dto/user.dto';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { ApiPageResponse } from '../common/dto/api-page-response';

/**
 * Orders under `/orders`. See `openapi.yaml:1375-1586`.
 *
 * Only the manager's list carries `@Roles('manager')`, because it is the one
 * operation the contract gives a 403. The three that resolve one order carry
 * every role and leave the ownership rule to the service, which answers 404
 * and not 403 for another client's order. Each handler is named after its
 * contract operation id, which the drift suite compares.
 */
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Roles(...ROLE_NAMES)
  @ApiOperation({ summary: 'Create an order from the cart' })
  @ApiResponse({
    status: 201,
    description: 'The server created the order.',
    type: OrderDto,
    headers: {
      Location: {
        description: 'The URL of the new order.',
        schema: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'The request has no valid token.' })
  @ApiResponse({
    status: 409,
    description: 'The cart is empty, or a line is above the units on hand.',
  })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createOrder(
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderDto> {
    const order = await this.orders.createOrder(user);
    res.setHeader('Location', `/v1/orders/${order.id}`);
    return order;
  }

  @Roles('manager')
  @ApiOperation({ summary: 'List every order' })
  @ApiPageResponse(OrderSummaryDto, 'One page of orders.')
  @ApiResponse({ status: 400, description: 'The query is invalid.' })
  @ApiResponse({ status: 401, description: 'The request has no valid token.' })
  @ApiResponse({ status: 403, description: 'The caller is not a manager.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Get()
  listAllOrders(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: ListAllOrdersQueryDto,
  ) {
    return this.orders.listAllOrders(user, query);
  }

  @Roles(...ROLE_NAMES)
  @ApiOperation({ summary: 'Get one order' })
  @ApiResponse({ status: 200, description: 'The order.', type: OrderDto })
  @ApiResponse({ status: 400, description: 'The id is not an integer.' })
  @ApiResponse({ status: 401, description: 'The request has no valid token.' })
  @ApiResponse({
    status: 404,
    description: 'The order does not exist, or belongs to another client.',
  })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Get(':id')
  getOrder(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseIdPipe) id: number,
  ): Promise<OrderDto> {
    return this.orders.getOrder(user, id);
  }

  @Roles(...ROLE_NAMES)
  @ApiOperation({ summary: 'Move an order to another status' })
  @ApiResponse({
    status: 200,
    description: 'The order, with its new status.',
    type: OrderDto,
  })
  @ApiResponse({ status: 400, description: 'The request body is invalid.' })
  @ApiResponse({ status: 401, description: 'The request has no valid token.' })
  @ApiResponse({
    status: 403,
    description: 'The caller may not send this status.',
  })
  @ApiResponse({
    status: 404,
    description: 'The order does not exist, or belongs to another client.',
  })
  @ApiResponse({
    status: 409,
    description: 'The current status does not allow this move.',
  })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Patch(':id/status')
  setOrderStatus(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseIdPipe) id: number,
    @Body() dto: SetOrderStatusDto,
  ): Promise<OrderDto> {
    return this.orders.setOrderStatus(user, id, dto);
  }
}

/** The client's own history, on the path the contract puts it. */
@ApiTags('orders')
@Controller('users/me/orders')
export class MyOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Roles(...ROLE_NAMES)
  @ApiOperation({ summary: 'List the orders of this user' })
  @ApiPageResponse(OrderSummaryDto, 'One page of orders.')
  @ApiResponse({ status: 400, description: 'The query is invalid.' })
  @ApiResponse({ status: 401, description: 'The request has no valid token.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Get()
  listMyOrders(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: OrderHistoryQueryDto,
  ) {
    return this.orders.listMyOrders(user, query);
  }
}
