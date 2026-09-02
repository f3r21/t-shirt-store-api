import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PageQueryDto } from '../common/dto/page-query.dto';
import { PageMetaDto } from '../common/dto/page-meta.dto';
import { CategoryDto } from './dto/category.dto';
import { toCategoryDto } from './category.mapper';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The category list. Public, because a shopper filters by category before
   * signing in.
   *
   * `total` counts every row, before limit and offset apply, so it comes from
   * its own count rather than the length of the page.
   *
   * The contract names no order. Name ascending is ours, because a list a human
   * reads should be alphabetical, and the tiebreak on `id` is what stops a page
   * under LIMIT from returning an unpredictable subset when two names match.
   */
  async listCategories(
    query: PageQueryDto,
  ): Promise<{ data: CategoryDto[]; meta: PageMetaDto }> {
    const [rows, total] = await Promise.all([
      this.prisma.category.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.category.count(),
    ]);

    return {
      data: rows.map(toCategoryDto),
      meta: { total, limit: query.limit, offset: query.offset },
    };
  }

  /**
   * Every id in the list must name a real category.
   *
   * Counting is enough: the ids are already unique by DTO validation, so a
   * count below the length means at least one names nothing. The contract
   * answers that with 422 and not 400, because the body is well formed and the
   * server rejects it on its content.
   */
  async assertAllExist(ids: readonly number[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const found = await this.prisma.category.count({
      where: { id: { in: [...ids] } },
    });
    if (found !== ids.length) {
      throw new UnprocessableEntityException({
        title: 'Unprocessable content',
        detail: 'The request names a category that does not exist.',
      });
    }
  }
}
