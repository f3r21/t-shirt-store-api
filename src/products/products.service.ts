import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { CategoriesService } from '../categories/categories.service';
import { AccessTokenPayload } from '../auth/access-token-payload';
import { PageMetaDto } from '../common/dto/page-meta.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductDto } from './dto/product.dto';
import { ProductSummaryDto } from './dto/product-summary.dto';
import {
  isManager,
  NOT_DELETED,
  visibleProductWhere,
} from './product-visibility';
import {
  PRODUCT_DETAIL_INCLUDE,
  toProductDto,
  toProductSummaryDto,
} from './product.mapper';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
  ) {}

  /**
   * The product list. Authentication is optional here.
   *
   * Three states, and they are the reason this operation is spelled the way it
   * is in the contract. A caller with no token sees the enabled products. A
   * manager may ask for the disabled ones too. A client who asks for them is
   * refused, and an anonymous caller who asks is refused differently: 401,
   * because the server cannot know whether they are a manager until they say
   * who they are.
   */
  async listProducts(
    viewer: AccessTokenPayload | undefined,
    query: ListProductsQueryDto,
  ): Promise<{ data: ProductSummaryDto[]; meta: PageMetaDto }> {
    if (query.includeInactive) {
      if (viewer === undefined) {
        throw new UnauthorizedException({
          title: 'Unauthorized',
          detail: 'This operation needs a bearer token.',
        });
      }
      if (!isManager(viewer)) {
        throw new ForbiddenException();
      }
    }

    const where: Prisma.ProductWhereInput = {
      ...visibleProductWhere(viewer, query.includeInactive),
    };
    if (query.categoryId !== undefined) {
      where.categories = { some: { categoryId: query.categoryId } };
    }

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.product.count({ where }),
    ]);

    const ids = rows.map((row) => row.id);
    const [priceFrom, primaryImage] = await Promise.all([
      this.cheapestVariantByProduct(ids),
      this.primaryImageByProduct(ids),
    ]);

    return {
      data: rows.map((row) =>
        toProductSummaryDto(
          row,
          priceFrom.get(row.id),
          primaryImage.get(row.id),
        ),
      ),
      meta: { total, limit: query.limit, offset: query.offset },
    };
  }

  /**
   * The primary image of each product on this page, in one query.
   *
   * The same shape as `cheapestVariantByProduct`, for the same reason: one
   * round trip per page and never one per row. A product with no primary image
   * is absent from the map, so `primaryImageUrl` is absent from its entry,
   * which is what the contract asks for.
   *
   * The schema has no unique index on `(product_id, is_primary)`, so two rows
   * of one product could both claim primary. The lowest id wins, by the
   * `orderBy` and the `has` check, so the answer is stable rather than
   * whichever row the planner returned first.
   *
   * Nothing writes `product_images` until `uploadProductImage` lands, so every
   * page built through the API gets an empty map today. It is wired now so
   * that operation lands into a working list.
   */
  private async primaryImageByProduct(
    productIds: readonly number[],
  ): Promise<Map<number, string>> {
    if (productIds.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.productImage.findMany({
      where: { productId: { in: [...productIds] }, isPrimary: true },
      select: { productId: true, url: true },
      orderBy: { id: 'asc' },
    });

    const primary = new Map<number, string>();
    for (const row of rows) {
      if (!primary.has(row.productId)) {
        primary.set(row.productId, row.url);
      }
    }
    return primary;
  }

  /**
   * The cheapest variant of each product on this page, in one query.
   *
   * A `groupBy` over the page's ids rather than a query per row. Without it the
   * list costs one round trip per product, which is the N+1 this endpoint is
   * most likely to grow. A product with no variants is absent from the result
   * and therefore absent from the response, which is what the contract asks for.
   */
  private async cheapestVariantByProduct(
    productIds: readonly number[],
  ): Promise<Map<number, number>> {
    if (productIds.length === 0) {
      return new Map();
    }

    const grouped = await this.prisma.productVariant.groupBy({
      by: ['productId'],
      where: { productId: { in: [...productIds] } },
      _min: { priceCents: true },
    });

    const cheapest = new Map<number, number>();
    for (const row of grouped) {
      if (row._min.priceCents !== null) {
        cheapest.set(row.productId, row._min.priceCents);
      }
    }
    return cheapest;
  }

  /**
   * One product, with its variants and categories.
   *
   * A manager sees a disabled product and nobody else does. There is no flag on
   * this operation, so the manager's view is unconditional rather than
   * requested, which is why `includeInactive` is passed as true here.
   */
  async getProduct(
    viewer: AccessTokenPayload | undefined,
    id: number,
  ): Promise<ProductDto> {
    const product = await this.prisma.product.findFirst({
      where: { id, ...visibleProductWhere(viewer, true) },
      include: PRODUCT_DETAIL_INCLUDE,
    });
    if (product === null) {
      throw new NotFoundException();
    }
    return toProductDto(product);
  }

  /**
   * Create a product, optionally in categories.
   *
   * The categories are checked before the write, because a category id that
   * names nothing is 422 and not a foreign key violation, which nothing maps
   * and which would surface as 500.
   */
  async createProduct(dto: CreateProductDto): Promise<ProductDto> {
    const categoryIds = dto.categoryIds ?? [];
    await this.categories.assertAllExist(categoryIds);

    const product = await this.prisma.product.create({
      data: {
        name: dto.name,
        description: dto.description,
        categories: {
          create: categoryIds.map((categoryId) => ({ categoryId })),
        },
      },
      include: PRODUCT_DETAIL_INCLUDE,
    });

    return toProductDto(product);
  }

  /**
   * Update a product, and replace its categories when the body names them.
   *
   * `categoryIds` absent means leave them alone; present means this is now the
   * whole set. Replacement happens inside one transaction with the update, so a
   * failure cannot leave a product with its categories deleted and not rewritten.
   */
  async updateProduct(id: number, dto: UpdateProductDto): Promise<ProductDto> {
    await this.assertProductExists(id);

    if (dto.categoryIds !== undefined) {
      await this.categories.assertAllExist(dto.categoryIds);
    }

    const product = await this.prisma.$transaction(async (tx) => {
      if (dto.categoryIds !== undefined) {
        await tx.productCategory.deleteMany({ where: { productId: id } });
        await tx.productCategory.createMany({
          data: dto.categoryIds.map((categoryId) => ({
            productId: id,
            categoryId,
          })),
        });
      }

      return tx.product.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          isActive: dto.isActive,
        },
        include: PRODUCT_DETAIL_INCLUDE,
      });
    });

    return toProductDto(product);
  }

  /**
   * Withdraw a product from the catalog.
   *
   * Soft, because order history points at the variants of products that may
   * since have been withdrawn, so the row has to survive while the catalog
   * stops showing it. Disabling and deleting are different acts: a disabled
   * product is coming back, a deleted one is not.
   *
   * A second delete answers 404, because the visibility filter already excludes
   * the row.
   */
  async deleteProduct(id: number): Promise<void> {
    await this.assertProductExists(id);
    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** Resolve a product that is not deleted, whatever its active state, or 404. */
  private async assertProductExists(id: number): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id, ...NOT_DELETED },
      select: { id: true },
    });
    if (product === null) {
      throw new NotFoundException();
    }
  }
}
