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

    /**
     * The page reaches the database, and the envelope reports what was asked.
     *
     * Both halves were unasserted, and both survived a mutation run: deleting
     * `take` and `skip` from `products.service.ts:72-73` left all 245 tests
     * green, and so did deleting `limit` and `offset` from the `meta` at :84.
     * `listSessions`, an operation the brief never mentions, was pinned at
     * `auth.service.spec.ts:487-494` while this one, which the capstone names by
     * name at line 45, was not.
     *
     * The two assertions answer different failures and neither substitutes for
     * the other. `take` and `skip` say the database returned a page. `meta` says
     * the caller was told which page, which is what a client needs to ask for
     * the next one.
     */
    it('passes limit and offset to findMany as take and skip', async () => {
      await service.listProducts(undefined, query({ limit: 5, offset: 40 }));

      const call = nthArg(prisma.product.findMany) as {
        take: number;
        skip: number;
      };
      expect(call.take).toBe(5);
      expect(call.skip).toBe(40);
    });

    it('applies the contract defaults when the query names neither', async () => {
      // Built from the DTO rather than from a literal, so this asserts the
      // contract's default and not a number written twice.
      await service.listProducts(undefined, query());

      const call = nthArg(prisma.product.findMany) as {
        take: number;
        skip: number;
      };
      expect(call.take).toBe(20);
      expect(call.skip).toBe(0);
    });

    it('echoes limit and offset back in meta', async () => {
      const result = await service.listProducts(
        undefined,
        query({ limit: 5, offset: 40 }),
      );

      expect(result.meta.limit).toBe(5);
      expect(result.meta.offset).toBe(40);
    });

    it('never sends take or skip to the count, which must see every match', async () => {
      // The count is the total before the page applies. Paginating it would make
      // `meta.total` the size of the page, and every client's "page N of M"
      // would read 1 of 1.
      await service.listProducts(undefined, query({ limit: 5, offset: 40 }));

      const countCall = nthArg(prisma.product.count);
      expect(countCall).not.toHaveProperty('take');
      expect(countCall).not.toHaveProperty('skip');
    });

    /**
     * The total is a second query and it has to carry the same visibility rule.
     *
     * The test above asserts what the mock returned, which is the shape of
     * assertion that cannot see this: counting the whole table would satisfy it
     * and would tell an anonymous caller how many withdrawn and disabled
     * products exist. `meta.total` is a read of hidden rows if it is not
     * filtered, even though none of them appears in `data`.
     */
    it('counts with the visibility rule and not the whole table', async () => {
      await service.listProducts(undefined, query());

      const call = nthArg(prisma.product.count) as {
        where: { deletedAt: null; isActive: boolean };
      };
      expect(call.where.deletedAt).toBeNull();
      expect(call.where.isActive).toBe(true);
    });

    it('orders by an expression that pins the rows uniquely', async () => {
      await service.listProducts(undefined, query());

      const call = nthArg(prisma.product.findMany) as {
        orderBy: Record<string, string>[];
      };
      expect(call.orderBy[call.orderBy.length - 1]).toEqual({ id: 'desc' });
    });

    /**
     * "Search products by category" is the one catalog behaviour the challenge
     * names by its own name, and until these three tests it could be deleted
     * whole with the suite green.
     *
     * `some` and not `every`: a product sits in several categories, and asking
     * for one of them must not require it to sit in only that one.
     */
    it('filters by the category the query names', async () => {
      await service.listProducts(undefined, query({ categoryId: 4 }));

      const call = nthArg(prisma.product.findMany) as {
        where: { categories?: { some: { categoryId: number } } };
      };
      expect(call.where.categories).toEqual({ some: { categoryId: 4 } });
    });

    it('sends no category filter when the query names none', async () => {
      await service.listProducts(undefined, query());

      // The negative half. Without it a hard-coded category would satisfy the
      // test above and quietly hide most of the catalog.
      const call = nthArg(prisma.product.findMany) as {
        where: { categories?: unknown };
      };
      expect(call.where.categories).toBeUndefined();
    });

    /**
     * The count and the page have to agree.
     *
     * `meta.total` drives the client's pager. Filtering the rows and counting
     * the whole catalog reads as a working filter on page one and hands the
     * caller pages that come back empty, which is the shape of bug a status code
     * assertion never sees.
     */
    it('counts the page with the same filter it lists it with', async () => {
      await service.listProducts(undefined, query({ categoryId: 4 }));

      const listed = nthArg(prisma.product.findMany) as { where: unknown };
      const counted = nthArg(prisma.product.count) as { where: unknown };
      expect(counted.where).toEqual(listed.where);
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
