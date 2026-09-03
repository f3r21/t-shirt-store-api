import { Injectable, NotFoundException } from '@nestjs/common';
import { accessibleBy } from '@casl/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { CategoriesService } from '../categories/categories.service';
import type { AppAbility } from '../authz/ability';
import { PageMetaDto } from '../common/dto/page-meta.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductDto } from './dto/product.dto';
import { ProductSummaryDto } from './dto/product-summary.dto';
import { NOT_DELETED } from './product-visibility';
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
   * The product list. Who may ask for the inactive ones was decided at the
   * controller. ADR 16, ADR 25.
   */
  async listProducts(
    ability: AppAbility,
    query: ListProductsQueryDto,
  ): Promise<{ data: ProductSummaryDto[]; meta: PageMetaDto }> {
    // The visibility rule is the ability's own condition. A manager who did
    // not ask for the inactive ones gets the shopper's view.
    const where: Prisma.ProductWhereInput = {
      AND: [accessibleBy(ability).Product],
      ...(query.includeInactive ? {} : { isActive: true }),
    };
    if (query.categoryId !== undefined) {
      where.categories = { some: { categoryId: query.categoryId } };
    }

    return this.pageOf(where, query);
  }

  /**
   * One page of summaries under any predicate, shared with the liked list.
   * ADR 26.
   */
  async pageOf(
    where: Prisma.ProductWhereInput,
    query: { limit: number; offset: number },
  ): Promise<{ data: ProductSummaryDto[]; meta: PageMetaDto }> {
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
   * The primary image of each product on the page, in one query. The lowest
   * id wins when two rows claim primary, so the answer is stable.
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
   * The cheapest variant of each product on the page, in one query. A product
   * with no variants is absent. ADR 17.
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

  /** One product with its variants and categories; a manager sees a disabled one. */
  async getProduct(ability: AppAbility, id: number): Promise<ProductDto> {
    const product = await this.prisma.product.findFirst({
      where: { id, AND: [accessibleBy(ability).Product] },
      include: PRODUCT_DETAIL_INCLUDE,
    });
    if (product === null) {
      throw new NotFoundException();
    }
    return toProductDto(product);
  }

  /**
   * Create a product. The categories are checked first, so an unknown id is
   * 422 and not a foreign key violation.
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
   * Update a product. A present `categoryIds` replaces the whole set, in the
   * same transaction as the update.
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
   * Withdraw a product: soft, because order history points at its variants.
   * A second delete is 404. ADR 15.
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
