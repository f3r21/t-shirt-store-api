import {
  Body,
  Controller,
  Delete,
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
import { ApiPageResponse } from '../common/dto/api-page-response';
import { ProductSummaryDto } from './dto/product-summary.dto';
import type { Response } from 'express';
import { ProductsService } from './products.service';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductDto } from './dto/product.dto';
import { CheckPolicies } from '../authz/check-policies.decorator';
import { can, inactiveProductsNeedManager } from '../authz/policies';
import { CurrentAbility } from '../authz/current-ability.decorator';
import type { AppAbility } from '../authz/ability';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { NonEmptyBodyPipe } from '../common/non-empty-body.pipe';

@ApiTags('catalog')
@Controller('products')
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
  @CheckPolicies(can('read', 'Product'), inactiveProductsNeedManager)
  @ApiOperation({ summary: 'List products' })
  @ApiPageResponse(ProductSummaryDto, 'A page of products.')
  @ApiResponse({ status: 400, description: 'The query is invalid.' })
  @ApiResponse({ status: 401, description: 'The token is absent or invalid.' })
  @ApiResponse({ status: 403, description: 'The caller is not a manager.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Get()
  listProducts(
    @CurrentAbility() ability: AppAbility,
    @Query() query: ListProductsQueryDto,
  ) {
    return this.products.listProducts(ability, query);
  }

  @OptionalAuth()
  @CheckPolicies(can('read', 'Product'))
  @ApiOperation({ summary: 'Get one product' })
  @ApiResponse({
    status: 200,
    description: 'The product.',
    type: ProductDto,
  })
  @ApiResponse({ status: 401, description: 'The token is invalid.' })
  @ApiResponse({ status: 404, description: 'The product does not exist.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Get(':id')
  getProduct(
    @CurrentAbility() ability: AppAbility,
    @Param('id', ParseIdPipe) id: number,
  ): Promise<ProductDto> {
    return this.products.getProduct(ability, id);
  }

  @CheckPolicies(can('create', 'Product'))
  @ApiOperation({ summary: 'Create a product' })
  @ApiResponse({
    status: 201,
    description: 'The product is created.',
    type: ProductDto,
    headers: {
      Location: {
        description: 'The URL of the new product.',
        schema: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'The request body is invalid.' })
  @ApiResponse({ status: 401, description: 'The token is absent or invalid.' })
  @ApiResponse({ status: 403, description: 'The caller is not a manager.' })
  @ApiResponse({ status: 422, description: 'The request body fails a rule.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
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

  @CheckPolicies(can('update', 'Product'))
  @ApiOperation({ summary: 'Update a product' })
  @ApiResponse({
    status: 200,
    description: 'The product is updated.',
    type: ProductDto,
  })
  @ApiResponse({ status: 400, description: 'The request body is invalid.' })
  @ApiResponse({ status: 401, description: 'The token is absent or invalid.' })
  @ApiResponse({ status: 403, description: 'The caller is not a manager.' })
  @ApiResponse({ status: 404, description: 'The product does not exist.' })
  @ApiResponse({ status: 422, description: 'The request body fails a rule.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Patch(':id')
  updateProduct(
    @Param('id', ParseIdPipe) id: number,
    @Body(NonEmptyBodyPipe) dto: UpdateProductDto,
  ): Promise<ProductDto> {
    return this.products.updateProduct(id, dto);
  }

  @CheckPolicies(can('delete', 'Product'))
  @ApiOperation({ summary: 'Delete a product' })
  @ApiResponse({ status: 204, description: 'The product is deleted.' })
  @ApiResponse({ status: 401, description: 'The token is absent or invalid.' })
  @ApiResponse({ status: 403, description: 'The caller is not a manager.' })
  @ApiResponse({ status: 404, description: 'The product does not exist.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteProduct(@Param('id', ParseIdPipe) id: number): Promise<void> {
    return this.products.deleteProduct(id);
  }
}
