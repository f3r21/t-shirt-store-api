import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LikesService } from './likes.service';
import { ProductSummaryDto } from '../products/dto/product-summary.dto';
import { PageQueryDto } from '../common/dto/page-query.dto';
import { ApiPageResponse } from '../common/dto/api-page-response';
import { CheckPolicies } from '../authz/check-policies.decorator';
import { can } from '../authz/policies';
import { CurrentAbility } from '../authz/current-ability.decorator';
import type { AppAbility } from '../authz/ability';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/access-token-payload';
import { ParseIdPipe } from '../common/parse-id.pipe';

/**
 * The likes. Every signed-in caller may like and unlike, as the contract
 * declares no 403; both answer 204, and a repeat answers the same. Each
 * handler is named after its operation id.
 */
@ApiTags('catalog')
@ApiResponse({ status: 401, description: 'The request has no valid token.' })
@ApiResponse({ status: 500, description: 'The server failed.' })
@Controller('variants')
export class LikesController {
  constructor(private readonly likes: LikesService) {}

  @CheckPolicies(can('manage', 'ProductLike'))
  @ApiOperation({ summary: 'Like a variant' })
  @ApiResponse({ status: 204, description: 'The user likes this variant.' })
  @ApiResponse({ status: 400, description: 'The id is not an integer.' })
  @ApiResponse({
    status: 404,
    description: 'The variant does not exist, or its product is not on sale.',
  })
  @Put(':id/like')
  @HttpCode(HttpStatus.NO_CONTENT)
  likeVariant(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseIdPipe) id: number,
  ): Promise<void> {
    return this.likes.likeVariant(user, id);
  }

  @CheckPolicies(can('manage', 'ProductLike'))
  @ApiOperation({ summary: 'Remove a like' })
  @ApiResponse({
    status: 204,
    description: 'The user does not like this variant.',
  })
  @ApiResponse({ status: 400, description: 'The id is not an integer.' })
  @ApiResponse({ status: 404, description: 'The variant does not exist.' })
  @Delete(':id/like')
  @HttpCode(HttpStatus.NO_CONTENT)
  unlikeVariant(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseIdPipe) id: number,
  ): Promise<void> {
    return this.likes.unlikeVariant(user, id);
  }
}

/** The liked products, on the path the contract puts them. */
@ApiTags('catalog')
@ApiResponse({ status: 401, description: 'The request has no valid token.' })
@ApiResponse({ status: 500, description: 'The server failed.' })
@Controller('users/me/likes')
export class MyLikesController {
  constructor(private readonly likes: LikesService) {}

  @CheckPolicies(can('manage', 'ProductLike'))
  @ApiOperation({ summary: 'List the products this user likes' })
  @ApiPageResponse(ProductSummaryDto, 'One page of liked products.')
  @ApiResponse({ status: 400, description: 'The query is invalid.' })
  @Get()
  listLikedProducts(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentAbility() ability: AppAbility,
    @Query() query: PageQueryDto,
  ) {
    return this.likes.listLikedProducts(user, ability, query);
  }
}
