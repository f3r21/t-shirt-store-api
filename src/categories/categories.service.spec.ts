import { Test } from '@nestjs/testing';
import { CategoriesService } from './categories.service';
import type { PrismaMock } from '../prisma/prisma.service.mock';
import {
  createPrismaMock,
  prismaMockProvider,
} from '../prisma/prisma.service.mock';
import { aCategory } from '../products/products.fixtures';
import { nthArg } from '../common/mock-args';
import { PageQueryDto } from '../common/dto/page-query.dto';

describe('CategoriesService', () => {
  let service: CategoriesService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = createPrismaMock();
    const module = await Test.createTestingModule({
      providers: [CategoriesService, prismaMockProvider(prisma)],
    }).compile();
    service = module.get(CategoriesService);
  });

  describe('listCategories', () => {
    beforeEach(() => {
      prisma.category.findMany.mockResolvedValue([aCategory()]);
      prisma.category.count.mockResolvedValue(1);
    });

    it('returns a data and meta envelope, and never a bare array', async () => {
      const result = await service.listCategories(new PageQueryDto());

      expect(Object.keys(result).sort()).toEqual(['data', 'meta']);
      expect(result.data).toEqual([{ id: 3, name: 'T-shirts' }]);
    });

    it('counts every row, not the page', async () => {
      prisma.category.count.mockResolvedValue(42);

      const result = await service.listCategories(new PageQueryDto());

      expect(result.meta.total).toBe(42);
      expect(prisma.category.count).toHaveBeenCalledWith();
    });

    /**
     * The same gap as the product list, in the other paginated collection.
     *
     * Deleting `take` and `skip` from `categories.service.ts:29-30` left the
     * whole suite green, so every request read the whole table and the response
     * still looked paginated because `meta` is built from the query rather than
     * from what came back.
     */
    it('passes limit and offset to findMany as take and skip', async () => {
      await service.listCategories(
        Object.assign(new PageQueryDto(), { limit: 5, offset: 40 }),
      );

      const call = nthArg(prisma.category.findMany) as {
        take: number;
        skip: number;
      };
      expect(call.take).toBe(5);
      expect(call.skip).toBe(40);
    });

    it('applies the contract defaults when the query names neither', async () => {
      await service.listCategories(new PageQueryDto());

      const call = nthArg(prisma.category.findMany) as {
        take: number;
        skip: number;
      };
      expect(call.take).toBe(20);
      expect(call.skip).toBe(0);
    });

    it('echoes limit and offset back in meta', async () => {
      const result = await service.listCategories(
        Object.assign(new PageQueryDto(), { limit: 5, offset: 40 }),
      );

      expect(result.meta.limit).toBe(5);
      expect(result.meta.offset).toBe(40);
    });

    it('orders by name and breaks the tie on id', async () => {
      await service.listCategories(new PageQueryDto());

      const call = nthArg(prisma.category.findMany) as {
        orderBy: Record<string, string>[];
      };
      expect(call.orderBy).toEqual([{ name: 'asc' }, { id: 'asc' }]);
    });
  });

  describe('assertAllExist', () => {
    it('accepts an empty list without asking the database', async () => {
      await expect(service.assertAllExist([])).resolves.toBeUndefined();

      expect(prisma.category.count).not.toHaveBeenCalled();
    });

    it('accepts a list where every id resolves', async () => {
      prisma.category.count.mockResolvedValue(2);

      await expect(service.assertAllExist([3, 4])).resolves.toBeUndefined();
    });

    it('rejects with 422 when an id names nothing', async () => {
      prisma.category.count.mockResolvedValue(1);

      // 422 and not 400: the body is well formed and the server rejects it on
      // its content.
      await expect(service.assertAllExist([3, 999])).rejects.toMatchObject({
        status: 422,
      });
    });
  });
});
