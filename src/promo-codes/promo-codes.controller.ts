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
import { ApiPageResponse } from '../common/dto/api-page-response';
import { PageQueryDto } from '../common/dto/page-query.dto';
import { PromoCodesService } from './promo-codes.service';
import { CreatePromoCodeDto } from './dto/create-promo-code.dto';
import { UpdatePromoCodeDto } from './dto/update-promo-code.dto';
import { PromoCodeDto } from './dto/promo-code.dto';
import { CheckPolicies } from '../authz/check-policies.decorator';
import { can } from '../authz/policies';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { NonEmptyBodyPipe } from '../common/non-empty-body.pipe';

@ApiTags('promo-codes')
@ApiResponse({ status: 500, description: 'The server failed.' })
@Controller('promo-codes')
export class PromoCodesController {
  constructor(private readonly promoCodes: PromoCodesService) {}

  @CheckPolicies(can('create', 'PromoCode'))
  @ApiOperation({ summary: 'Create a promo code' })
  @ApiResponse({
    status: 201,
    description: 'The promo code is created.',
    type: PromoCodeDto,
    headers: {
      Location: {
        description: 'The URL of the new promo code.',
        schema: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'The request body is invalid.' })
  @ApiResponse({ status: 401, description: 'The token is absent or invalid.' })
  @ApiResponse({ status: 403, description: 'The caller is not a manager.' })
  @ApiResponse({
    status: 409,
    description: 'Another promo code already uses this code.',
  })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createPromoCode(
    @Body() dto: CreatePromoCodeDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PromoCodeDto> {
    const promoCode = await this.promoCodes.createPromoCode(dto);
    res.setHeader('Location', `/v1/promo-codes/${promoCode.id}`);
    return promoCode;
  }

  @CheckPolicies(can('read', 'PromoCode'))
  @ApiOperation({ summary: 'List the promo codes' })
  @ApiPageResponse(PromoCodeDto, 'A page of promo codes.')
  @ApiResponse({ status: 400, description: 'The query is invalid.' })
  @ApiResponse({ status: 401, description: 'The token is absent or invalid.' })
  @ApiResponse({ status: 403, description: 'The caller is not a manager.' })
  @Get()
  listPromoCodes(@Query() query: PageQueryDto) {
    return this.promoCodes.listPromoCodes(query);
  }

  @CheckPolicies(can('update', 'PromoCode'))
  @ApiOperation({ summary: 'Update a promo code' })
  @ApiResponse({
    status: 200,
    description: 'The promo code is updated.',
    type: PromoCodeDto,
  })
  @ApiResponse({ status: 400, description: 'The request body is invalid.' })
  @ApiResponse({ status: 401, description: 'The token is absent or invalid.' })
  @ApiResponse({ status: 403, description: 'The caller is not a manager.' })
  @ApiResponse({ status: 404, description: 'The promo code does not exist.' })
  @ApiResponse({
    status: 409,
    description: 'Another promo code already uses this code.',
  })
  @Patch(':id')
  updatePromoCode(
    @Param('id', ParseIdPipe) id: number,
    @Body(NonEmptyBodyPipe) dto: UpdatePromoCodeDto,
  ): Promise<PromoCodeDto> {
    return this.promoCodes.updatePromoCode(id, dto);
  }
}
