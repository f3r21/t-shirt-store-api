import { Injectable, NotFoundException } from '@nestjs/common';
import { accessibleBy } from '@casl/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import {
  NOT_DELETED,
  visibleProductWhere,
} from '../products/product-visibility';
import type { AppAbility } from '../authz/ability';
import type { AccessTokenPayload } from '../auth/access-token-payload';
import { PageQueryDto } from '../common/dto/page-query.dto';
import { PageMetaDto } from '../common/dto/page-meta.dto';
import { ProductSummaryDto } from '../products/dto/product-summary.dto';

/**
 * Likes, three operations over `product_likes`. See `openapi.yaml:772-875`.
 *
 * A like is a pair, the user and the variant, and nothing else: no counter
 * and no timestamp, because the contract exposes neither. The primary key
 * makes both writes idempotent, so `PUT` is an upsert with nothing to update
 * and `DELETE` removes what is there, zero rows included.
 *
 * **Two lookups, two rules.** A like needs a product on sale, through the
 * cart's own predicate, because a like on a disabled product would be a like
 * on something the storefront does not show. An unlike needs only a variant
 * that exists, because a like placed before the product was disabled must
 * still be removable. The list reads under the caller's own visibility, so a
 * liked product that was disabled after the like is kept and hidden until it
 * returns. DECISIONS 26.
 */
@Injectable()
export class LikesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  /** Record the like, or leave the one that is there. */
  async likeVariant(
    viewer: AccessTokenPayload,
    variantId: number,
  ): Promise<void> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, product: visibleProductWhere(undefined) },
      select: { id: true },
    });
    if (variant === null) {
      throw new NotFoundException();
    }

    const userId = viewer.sub;
    await this.prisma.productLike.upsert({
      where: { userId_variantId: { userId, variantId } },
      create: { userId, variantId },
      update: {},
    });
  }

  /** Remove the like, whether or not it was there. */
  async unlikeVariant(
    viewer: AccessTokenPayload,
    variantId: number,
  ): Promise<void> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, product: { ...NOT_DELETED } },
      select: { id: true },
    });
    if (variant === null) {
      throw new NotFoundException();
    }

    await this.prisma.productLike.deleteMany({
      where: { userId: viewer.sub, variantId },
    });
  }

  /**
   * The products this user likes, one page, in the product list's shape.
   *
   * A like sits on a variant, so the predicate is "some variant of this
   * product carries a like of mine", and a product with two liked variants is
   * one row by construction. The ability's condition is the caller's own
   * visibility, the same clause the product list reads with.
   */
  listLikedProducts(
    viewer: AccessTokenPayload,
    ability: AppAbility,
    query: PageQueryDto,
  ): Promise<{ data: ProductSummaryDto[]; meta: PageMetaDto }> {
    return this.products.pageOf(
      {
        AND: [
          accessibleBy(ability).Product,
          { variants: { some: { likes: { some: { userId: viewer.sub } } } } },
        ],
      },
      query,
    );
  }
}
