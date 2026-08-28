import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { VariantsService } from './variants.service';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { SetVariantStockDto } from './dto/set-variant-stock.dto';
import { ProductVariantDto } from './dto/product-variant.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

/**
 * Creating a variant hangs off its product, so it lives on the product path.
 *
 * `ParseIntPipe` on every id is not optional. A bare `@Param('id') id: number`
 * hands the string through, and `NaN` reaches Prisma as an invalid argument,
 * which nothing maps, so the caller reads 500 instead of 400.
 */
@Controller('products')
@UseGuards(RolesGuard)
export class ProductVariantsController {
  constructor(private readonly variants: VariantsService) {}

  @Roles('manager')
  @Post(':id/variants')
  @HttpCode(HttpStatus.CREATED)
  async createVariant(
    @Param('id', ParseIntPipe) productId: number,
    @Body() dto: CreateVariantDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProductVariantDto> {
    const variant = await this.variants.createVariant(productId, dto);
    res.setHeader('Location', `/v1/variants/${variant.id}`);
    return variant;
  }
}

@Controller('variants')
@UseGuards(RolesGuard)
export class VariantsController {
  constructor(private readonly variants: VariantsService) {}

  @Roles('manager')
  @Patch(':id')
  updateVariant(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVariantDto,
  ): Promise<ProductVariantDto> {
    return this.variants.updateVariant(id, dto);
  }

  @Roles('manager')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteVariant(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.variants.deleteVariant(id);
  }

  @Roles('manager')
  @Patch(':id/stock')
  setVariantStock(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetVariantStockDto,
  ): Promise<ProductVariantDto> {
    return this.variants.setVariantStock(id, dto);
  }
}
