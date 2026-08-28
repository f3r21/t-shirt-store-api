import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ProductsService } from './products.service';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductDto } from './dto/product.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/access-token-payload';

@Controller('products')
@UseGuards(RolesGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /**
   * Optional authentication, which is the third state and the reason
   * `@OptionalAuth` exists. A token is allowed and not required: anonymous
   * callers see the enabled products, and a manager who identifies themselves
   * can ask for the disabled ones too.
   *
   * `@Public` would not do. It returns before any token work, so a manager who
   * sent a token would be invisible to the handler.
   */
  @OptionalAuth()
  @Get()
  listProducts(
    @CurrentUser() viewer: AccessTokenPayload | undefined,
    @Query() query: ListProductsQueryDto,
  ) {
    return this.products.listProducts(viewer, query);
  }

  @OptionalAuth()
  @Get(':id')
  getProduct(
    @CurrentUser() viewer: AccessTokenPayload | undefined,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProductDto> {
    return this.products.getProduct(viewer, id);
  }

  @Roles('manager')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createProduct(
    @Body() dto: CreateProductDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProductDto> {
    const product = await this.products.createProduct(dto);
    res.setHeader('Location', `/v1/products/${product.id}`);
    return product;
  }

  @Roles('manager')
  @Patch(':id')
  updateProduct(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductDto> {
    return this.products.updateProduct(id, dto);
  }

  @Roles('manager')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteProduct(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.products.deleteProduct(id);
  }
}
