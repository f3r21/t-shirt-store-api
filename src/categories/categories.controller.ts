import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { PageQueryDto } from '../common/dto/page-query.dto';
import { Public } from '../auth/decorators/public.decorator';
import { ApiPageResponse } from '../common/dto/api-page-response';
import { CategoryDto } from './dto/category.dto';

@ApiTags('catalog')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  /**
   * Public. The access token guard is global, so without the marker this route
   * answers 401 and a shopper cannot browse before signing in.
   *
   * No `@HttpCode`: 200 is Nest's default for GET, and the contract asks for
   * 200. The path carries no `/v1`, because the prefix is set once in
   * `configureApp`.
   */
  @Public()
  @ApiOperation({ summary: 'List categories' })
  @ApiPageResponse(CategoryDto, 'The page of categories.')
  @ApiResponse({ status: 400, description: 'The query is not valid.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Get()
  listCategories(@Query() query: PageQueryDto) {
    return this.categories.listCategories(query);
  }
}
