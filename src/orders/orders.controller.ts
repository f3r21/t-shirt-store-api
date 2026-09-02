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
import { CheckPolicies } from '../authz/check-policies.decorator';
import { can, updateOrCancelOrder } from '../authz/policies';
import { CurrentAbility } from '../authz/current-ability.decorator';
import type { AppAbility } from '../authz/ability';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/access-token-payload';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { ApiPageResponse } from '../common/dto/api-page-response';

/**
 * Orders under `/orders`. See `openapi.yaml:1375-1586`.
 *
 * The policies are type-level, which is what a guard can know before the row
 * is read: `manage Order` opens the manager's list, the one operation the
 * contract gives a 403, and a client's `read Order` on their own rows passes
 * the same check because some orders are theirs. The three that resolve one
 * order hand the ability to the service, which turns the rule's condition
 * into the `where`, so another client's order is 404 and not 403, as the
 * contract asks. Each handler is named after its contract operation id, which
 * the drift suite compares.
 */
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @CheckPolicies(can('create', 'Order'))
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

  @CheckPolicies(can('manage', 'Order'))
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

  @CheckPolicies(can('read', 'Order'))
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
    @CurrentAbility() ability: AppAbility,
    @Param('id', ParseIdPipe) id: number,
  ): Promise<OrderDto> {
    return this.orders.getOrder(user, ability, id);
  }

  @CheckPolicies(updateOrCancelOrder)
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
    @CurrentAbility() ability: AppAbility,
    @Param('id', ParseIdPipe) id: number,
    @Body() dto: SetOrderStatusDto,
  ): Promise<OrderDto> {
    return this.orders.setOrderStatus(user, ability, id, dto);
  }
}

/** The client's own history, on the path the contract puts it. */
@ApiTags('orders')
@Controller('users/me/orders')
export class MyOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @CheckPolicies(can('read', 'Order'))
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
