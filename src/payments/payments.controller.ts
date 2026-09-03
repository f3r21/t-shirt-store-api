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
import { CheckPolicies } from '../authz/check-policies.decorator';
import { can } from '../authz/policies';
import { CurrentAbility } from '../authz/current-ability.decorator';
import type { AppAbility } from '../authz/ability';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/access-token-payload';
import { ParseIdPipe } from '../common/parse-id.pipe';

/**
 * The two Stripe flows and the webhook, three paths at three roots. The
 * webhook is `@Public()`: the signature over the raw body is its
 * authentication.
 */
@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @CheckPolicies(can('create', 'Order'))
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

  @CheckPolicies(can('pay', 'Order'))
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
    @CurrentAbility() ability: AppAbility,
    @Param('id', ParseIdPipe) id: number,
  ): Promise<PaymentIntentDto> {
    return this.payments.createPaymentIntent(user, ability, id);
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
