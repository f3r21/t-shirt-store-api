import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { VariantsService } from './variants.service';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { SetVariantStockDto } from './dto/set-variant-stock.dto';
import { ProductVariantDto } from './dto/product-variant.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { NonEmptyBodyPipe } from '../common/non-empty-body.pipe';

/**
 * Creating a variant hangs off its product, so it lives on the product path.
 *
 * `ParseIntPipe` on every id is not optional. A bare `@Param('id') id: number`
 * hands the string through, and `NaN` reaches Prisma as an invalid argument,
 * which nothing maps, so the caller reads 500 instead of 400.
 */
@ApiTags('catalog')
@Controller('products')
export class ProductVariantsController {
  constructor(private readonly variants: VariantsService) {}

  @Roles('manager')
  @ApiOperation({ summary: 'Create a variant' })
  @ApiResponse({
    status: 201,
    description: 'The variant is created.',
    type: ProductVariantDto,
  })
  @ApiResponse({ status: 400, description: 'The request body is invalid.' })
  @ApiResponse({ status: 401, description: 'The request has no valid token.' })
  @ApiResponse({ status: 403, description: 'The role is not permitted.' })
  @ApiResponse({ status: 404, description: 'The product does not exist.' })
  @ApiResponse({ status: 409, description: 'The variant already exists.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Post(':id/variants')
  @HttpCode(HttpStatus.CREATED)
  async createVariant(
    @Param('id', ParseIdPipe) productId: number,
    @Body() dto: CreateVariantDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProductVariantDto> {
    const variant = await this.variants.createVariant(productId, dto);
    res.setHeader('Location', `/v1/variants/${variant.id}`);
    return variant;
  }
}

@ApiTags('catalog')
@Controller('variants')
export class VariantsController {
  constructor(private readonly variants: VariantsService) {}

  @Roles('manager')
  @ApiOperation({ summary: 'Update a variant' })
  @ApiResponse({
    status: 200,
    description: 'The variant is updated.',
    type: ProductVariantDto,
  })
  @ApiResponse({ status: 400, description: 'The request body is invalid.' })
  @ApiResponse({ status: 401, description: 'The request has no valid token.' })
  @ApiResponse({ status: 403, description: 'The role is not permitted.' })
  @ApiResponse({ status: 404, description: 'The variant does not exist.' })
  @ApiResponse({ status: 409, description: 'The variant conflicts.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Patch(':id')
  updateVariant(
    @Param('id', ParseIdPipe) id: number,
    @Body(NonEmptyBodyPipe) dto: UpdateVariantDto,
  ): Promise<ProductVariantDto> {
    return this.variants.updateVariant(id, dto);
  }

  @Roles('manager')
  @ApiOperation({ summary: 'Remove a variant' })
  @ApiResponse({ status: 204, description: 'The variant is removed.' })
  @ApiResponse({ status: 401, description: 'The request has no valid token.' })
  @ApiResponse({ status: 403, description: 'The role is not permitted.' })
  @ApiResponse({ status: 404, description: 'The variant does not exist.' })
  @ApiResponse({ status: 409, description: 'The variant is in use.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteVariant(@Param('id', ParseIdPipe) id: number): Promise<void> {
    return this.variants.deleteVariant(id);
  }

  @Roles('manager')
  @ApiOperation({ summary: 'Set the stock of a variant' })
  @ApiResponse({
    status: 200,
    description: 'The stock is set.',
    type: ProductVariantDto,
  })
  @ApiResponse({ status: 400, description: 'The request body is invalid.' })
  @ApiResponse({ status: 401, description: 'The request has no valid token.' })
  @ApiResponse({ status: 403, description: 'The role is not permitted.' })
  @ApiResponse({ status: 404, description: 'The variant does not exist.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Patch(':id/stock')
  setVariantStock(
    @Param('id', ParseIdPipe) id: number,
    @Body() dto: SetVariantStockDto,
  ): Promise<ProductVariantDto> {
    return this.variants.setVariantStock(id, dto);
  }
}
