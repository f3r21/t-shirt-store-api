import { Test } from '@nestjs/testing';
import { CategoriesService } from './categories.service';
import {
  createPrismaMock,
  prismaMockProvider,
  PrismaMock,
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
