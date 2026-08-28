import { Test } from '@nestjs/testing';
import { ProductsService } from './products.service';
import { CategoriesService } from '../categories/categories.service';
import {
  createPrismaMock,
  prismaMockProvider,
  PrismaMock,
} from '../prisma/prisma.service.mock';
import {
  aProduct,
  aProductWithRelations,
  AS_CLIENT,
  AS_MANAGER,
} from './products.fixtures';
import { nthArg } from '../common/mock-args';
import { ListProductsQueryDto } from './dto/list-products-query.dto';

/**
 * The five product operations.
 *
 * The visibility rule is what most of this file is about, because it is three
 * states rather than two and the contract answers two of them with the same
 * status for different reasons.
 */
describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = createPrismaMock();

    const module = await Test.createTestingModule({
      providers: [
        ProductsService,
        CategoriesService,
        prismaMockProvider(prisma),
      ],
    }).compile();

    service = module.get(ProductsService);
  });

  const query = (over: Partial<ListProductsQueryDto> = {}) =>
    Object.assign(new ListProductsQueryDto(), over);

  describe('listProducts', () => {
    beforeEach(() => {
      prisma.product.findMany.mockResolvedValue([aProduct()]);
      prisma.product.count.mockResolvedValue(1);
      prisma.productVariant.groupBy.mockResolvedValue([
        { productId: 7, _min: { priceCents: 1999 } },
      ]);
    });

    it('hides deleted and disabled products from an anonymous caller', async () => {
      await service.listProducts(undefined, query());

      const call = nthArg(prisma.product.findMany) as {
        where: { deletedAt: null; isActive: boolean };
      };
      expect(call.where.deletedAt).toBeNull();
      expect(call.where.isActive).toBe(true);
    });

    it('still hides deleted products from a manager who asks for the inactive ones', async () => {
      await service.listProducts(AS_MANAGER, query({ includeInactive: true }));

      const call = nthArg(prisma.product.findMany) as {
        where: { deletedAt: null; isActive?: boolean };
      };
      // Deleted is 404 for everyone. Only the isActive filter is relaxed.
      expect(call.where.deletedAt).toBeNull();
      expect(call.where).not.toHaveProperty('isActive');
    });

    it('refuses includeInactive with 401 when nobody is signed in', async () => {
      // 401 and not 403: the server cannot know whether an anonymous caller is
      // a manager until they say who they are.
      await expect(
        service.listProducts(undefined, query({ includeInactive: true })),
      ).rejects.toMatchObject({ status: 401 });
    });

    it('refuses includeInactive with 403 when a client asks', async () => {
      await expect(
        service.listProducts(AS_CLIENT, query({ includeInactive: true })),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('reports priceFrom as the cheapest variant', async () => {
      const result = await service.listProducts(undefined, query());

      expect(result.data[0].priceFrom).toBe(1999);
    });

    it('leaves priceFrom absent when the product has no variant', async () => {
      prisma.productVariant.groupBy.mockResolvedValue([]);

      const result = await service.listProducts(undefined, query());

      // Absent, not zero. Zero would read as free.
      expect(result.data[0]).not.toHaveProperty('priceFrom');
    });

    it('asks for the cheapest variants of the whole page in one query', async () => {
      prisma.product.findMany.mockResolvedValue([
        aProduct({ id: 7 }),
        aProduct({ id: 8 }),
        aProduct({ id: 9 }),
      ]);

      await service.listProducts(undefined, query());

      // One groupBy for the page, not one query per row. This is the N+1 this
      // endpoint is most likely to grow.
      expect(prisma.productVariant.groupBy).toHaveBeenCalledTimes(1);
      const call = nthArg(prisma.productVariant.groupBy) as {
        where: { productId: { in: number[] } };
      };
      expect(call.where.productId.in).toEqual([7, 8, 9]);
    });

    it('reports the total before limit and offset apply', async () => {
      prisma.product.count.mockResolvedValue(347);

      const result = await service.listProducts(undefined, query());

      expect(result.meta.total).toBe(347);
      expect(result.data).toHaveLength(1);
    });

    it('orders by an expression that pins the rows uniquely', async () => {
      await service.listProducts(undefined, query());

      const call = nthArg(prisma.product.findMany) as {
        orderBy: Record<string, string>[];
      };
      expect(call.orderBy[call.orderBy.length - 1]).toEqual({ id: 'desc' });
    });
  });

  describe('getProduct', () => {
    it('returns the product with its variants and categories', async () => {
      prisma.product.findFirst.mockResolvedValue(aProductWithRelations());

      const result = await service.getProduct(AS_CLIENT, 7);

      expect(result.id).toBe(7);
      expect(result.variants).toHaveLength(1);
      expect(result.categories).toEqual([{ id: 3, name: 'T-shirts' }]);
      // Required by the contract and empty until images exist.
      expect(result.images).toEqual([]);
    });

    it('never leaks deletedAt or the raw price column', async () => {
      prisma.product.findFirst.mockResolvedValue(aProductWithRelations());

      const result = await service.getProduct(AS_CLIENT, 7);

      expect(result).not.toHaveProperty('deletedAt');
      expect(result.variants[0]).not.toHaveProperty('priceCents');
      expect(result.variants[0].price).toBe(1999);
    });

    it('answers 404 when the visibility filter matches nothing', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(service.getProduct(AS_CLIENT, 7)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('lets a manager see a disabled product and nobody else', async () => {
      prisma.product.findFirst.mockResolvedValue(aProductWithRelations());

      await service.getProduct(AS_MANAGER, 7);
      const asManager = nthArg(prisma.product.findFirst) as {
        where: Record<string, unknown>;
      };

      await service.getProduct(AS_CLIENT, 7);
      const asClient = nthArg(prisma.product.findFirst, 0, 1) as {
        where: { isActive?: boolean };
      };

      expect(asManager.where).not.toHaveProperty('isActive');
      expect(asClient.where.isActive).toBe(true);
    });
  });

  describe('createProduct', () => {
    it('rejects a category that names nothing with 422, not 400', async () => {
      // The body is well formed. The server rejects it on its content, which is
      // what separates 422 from 400 here.
      prisma.category.count.mockResolvedValue(1);

      await expect(
        service.createProduct({ name: 'Tee', categoryIds: [3, 999] }),
      ).rejects.toMatchObject({ status: 422 });

      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it('links every category the body names', async () => {
      prisma.category.count.mockResolvedValue(2);
      prisma.product.create.mockResolvedValue(aProductWithRelations());

      await service.createProduct({ name: 'Tee', categoryIds: [3, 4] });

      const call = nthArg(prisma.product.create) as {
        data: { categories: { create: { categoryId: number }[] } };
      };
      expect(call.data.categories.create).toEqual([
        { categoryId: 3 },
        { categoryId: 4 },
      ]);
    });

    it('checks nothing when the body names no category', async () => {
      prisma.product.create.mockResolvedValue(aProductWithRelations());

      await service.createProduct({ name: 'Tee' });

      expect(prisma.category.count).not.toHaveBeenCalled();
    });
  });

  describe('updateProduct', () => {
    beforeEach(() => {
      prisma.product.findFirst.mockResolvedValue(aProduct());
      prisma.product.update.mockResolvedValue(aProductWithRelations());
      prisma.productCategory.deleteMany.mockResolvedValue({ count: 1 });
      prisma.productCategory.createMany.mockResolvedValue({ count: 2 });
    });

    it('leaves the categories alone when the body does not name them', async () => {
      await service.updateProduct(7, { name: 'A new name' });

      // Absent means unchanged. Treating it as an empty set would silently
      // strip every category on a rename.
      expect(prisma.productCategory.deleteMany).not.toHaveBeenCalled();
      expect(prisma.productCategory.createMany).not.toHaveBeenCalled();
    });

    it('replaces the whole set when the body names them', async () => {
      prisma.category.count.mockResolvedValue(2);

      await service.updateProduct(7, { categoryIds: [3, 4] });

      expect(prisma.productCategory.deleteMany).toHaveBeenCalledWith({
        where: { productId: 7 },
      });
      const call = nthArg(prisma.productCategory.createMany) as {
        data: { productId: number; categoryId: number }[];
      };
      expect(call.data).toEqual([
        { productId: 7, categoryId: 3 },
        { productId: 7, categoryId: 4 },
      ]);
    });

    it('answers 404 for a deleted product', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.updateProduct(7, { name: 'A new name' }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('deleteProduct', () => {
    it('keeps the row and stamps deletedAt', async () => {
      prisma.product.findFirst.mockResolvedValue(aProduct());
      prisma.product.update.mockResolvedValue(aProduct());

      const before = Date.now();
      await service.deleteProduct(7);

      // Soft, because order history points at the variants of products that may
      // since have been withdrawn.
      expect(prisma.product.update).toHaveBeenCalled();
      const call = nthArg(prisma.product.update) as {
        where: { id: number };
        data: { deletedAt: Date };
      };
      expect(call.where).toEqual({ id: 7 });
      expect(call.data.deletedAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('answers 404 the second time, because the filter already excludes it', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(service.deleteProduct(7)).rejects.toMatchObject({
        status: 404,
      });
      expect(prisma.product.update).not.toHaveBeenCalled();
    });
  });
});
