import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PaymentsService } from './payments.service';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';
import { PaymentLinkDto } from './dto/payment-link.dto';
import { PaymentIntentDto } from './dto/payment-intent.dto';
import { StripeEventDto } from './dto/stripe-event.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/access-token-payload';
import { ROLE_NAMES } from '../users/dto/user.dto';
import { ParseIdPipe } from '../common/parse-id.pipe';

/**
 * The two Stripe flows and the webhook. See `openapi.yaml:1587-1742`.
 *
 * Three paths with three roots, so the controller sits at the root and each
 * handler carries its whole path. Each is named after its contract operation
 * id, which the drift suite compares.
 *
 * The webhook is `@Public()` because Stripe calls it and a person does not:
 * the signature over the raw body is its authentication, and `parseEvent`
 * refuses anything that does not verify before a byte of it is read.
 */
@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Roles(...ROLE_NAMES)
  @ApiOperation({ summary: 'Create a payment link for one product' })
  @ApiResponse({
    status: 201,
    description: 'The server created the order and the payment link.',
    type: PaymentLinkDto,
    headers: {
      Location: {
        description: 'The URL of the order this link pays for.',
        schema: { type: 'string' },
      },
    },
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
  @Post('payment-links')
  @HttpCode(HttpStatus.CREATED)
  async createPaymentLink(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreatePaymentLinkDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaymentLinkDto> {
    const link = await this.payments.createPaymentLink(user, dto);
    res.setHeader('Location', `/v1/orders/${link.orderId}`);
    return link;
  }

  @Roles(...ROLE_NAMES)
  @ApiOperation({ summary: 'Create a payment intent for an order' })
  @ApiResponse({
    status: 201,
    description: 'The server created the payment intent.',
    type: PaymentIntentDto,
  })
  @ApiResponse({ status: 400, description: 'The id is not an integer.' })
  @ApiResponse({ status: 401, description: 'The request has no valid token.' })
  @ApiResponse({
    status: 404,
    description: 'The order does not exist, or belongs to another client.',
  })
  @ApiResponse({
    status: 409,
    description:
      'The order is not pending, or a line is above the units on hand.',
  })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Post('orders/:id/payments')
  @HttpCode(HttpStatus.CREATED)
  createPaymentIntent(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseIdPipe) id: number,
  ): Promise<PaymentIntentDto> {
    return this.payments.createPaymentIntent(user, id);
  }

  @Public()
  @ApiOperation({ summary: 'Receive a Stripe event' })
  @ApiHeader({
    name: 'Stripe-Signature',
    required: true,
    description:
      'The signature Stripe computes over the raw body and the timestamp.',
  })
  @ApiBody({ type: StripeEventDto })
  @ApiResponse({
    status: 200,
    description: 'The server applied the event, or had applied it already.',
  })
  @ApiResponse({
    status: 400,
    description: 'The signature does not verify against the body.',
  })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Post('webhooks/stripe')
  @HttpCode(HttpStatus.OK)
  receiveStripeEvent(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<void> {
    return this.payments.receiveEvent(req.rawBody, signature);
  }
}
