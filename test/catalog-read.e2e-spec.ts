import request from 'supertest';
import {
  createTestApp,
  ensureCategory,
  ensureRoles,
  seedProductWithVariant,
  signInAs,
  truncateAll,
  TestApp,
} from './app-factory';

/**
 * Reading the catalog, against a real database.
 *
 * The unit tests for these paths assert the `where` object the service hands a
 * mocked Prisma client. That proves the service composed a filter. It cannot
 * prove the filter filters, because no row ever exists. This file is the half
 * that does, and it is the half the challenge asks for by name at line 46,
 * "Search products by category".
 */
describe('Catalog reads (e2e)', () => {
  let ctx: TestApp;
  let tees: number;
  let mugs: number;

  const http = () => request(ctx.app.getHttpServer());

  interface Page {
    data: { id: number; name: string }[];
    meta: { total: number; limit: number; offset: number };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await ensureRoles(ctx.prisma);
    tees = await ensureCategory(ctx.prisma, 'e2e-tees');
    mugs = await ensureCategory(ctx.prisma, 'e2e-mugs');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
  });

  describe('filtering by category', () => {
    beforeEach(async () => {
      await seedProductWithVariant(ctx.prisma, {
        name: 'A tee',
        categoryIds: [tees],
      });
      await seedProductWithVariant(ctx.prisma, {
        name: 'A mug',
        categoryIds: [mugs],
      });
    });

    it('returns only the products in the category asked for', async () => {
      const res = await http()
        .get('/v1/products')
        .query({ categoryId: tees })
        .expect(200);

      const page = res.body as Page;
      expect(page.data.map((p) => p.name)).toEqual(['A tee']);
    });

    /**
     * The total drives the client's pager, and it is computed by a second query
     * that has to carry the same filter. Filtering the rows while counting the
     * whole catalog looks correct on page one and hands the caller empty pages
     * after it.
     */
    it('counts only the filtered products', async () => {
      const res = await http()
        .get('/v1/products')
        .query({ categoryId: tees })
        .expect(200);

      expect((res.body as Page).meta.total).toBe(1);
    });

    it('returns the whole catalog when no category is named', async () => {
      const res = await http().get('/v1/products').expect(200);

      const page = res.body as Page;
      expect(page.meta.total).toBe(2);
      expect(page.data).toHaveLength(2);
    });

    /**
     * A product belongs to several categories at once, so the filter has to ask
     * whether the product is in this category and not whether it is in only this
     * category.
     */
    it('finds a product that sits in more than one category', async () => {
      await seedProductWithVariant(ctx.prisma, {
        name: 'A tee shaped mug',
        categoryIds: [tees, mugs],
      });

      const res = await http()
        .get('/v1/products')
        .query({ categoryId: mugs })
        .expect(200);

      const names = (res.body as Page).data.map((p) => p.name);
      expect(names).toContain('A tee shaped mug');
      expect(names).toContain('A mug');
      expect(names).not.toContain('A tee');
    });

    it('returns an empty page for a category that holds nothing', async () => {
      const empty = await ensureCategory(ctx.prisma, 'e2e-empty');

      const res = await http()
        .get('/v1/products')
        .query({ categoryId: empty })
        .expect(200);

      const page = res.body as Page;
      expect(page.data).toEqual([]);
      expect(page.meta.total).toBe(0);
    });
  });

  /**
   * The storefront stays open to a caller with no token.
   *
   * Both reads carry `@OptionalAuth()` and nothing asserted it. Delete either
   * decorator and the handler carries no marker at all: the token guard demands
   * a token and the roles guard denies by default, so the whole catalog closes
   * to every shopper who has not signed in. The break is loud in production and
   * was silent in CI.
   */
  describe('visibility, which is three states and not two', () => {
    it('serves the list with no token at all', async () => {
      await seedProductWithVariant(ctx.prisma, { name: 'On sale' });

      const res = await http().get('/v1/products').expect(200);

      expect((res.body as Page).data.map((p) => p.name)).toEqual(['On sale']);
    });

    it('serves the detail with no token at all', async () => {
      const { productId } = await seedProductWithVariant(ctx.prisma, {
        name: 'On sale',
      });

      const res = await http().get(`/v1/products/${productId}`).expect(200);

      expect(res.body).toMatchObject({ id: productId, name: 'On sale' });
    });

    /**
     * The regression `ARCHITECTURE.md:131-139` names as the largest gap left,
     * written the way that section asks for it. The 21 product unit tests assert
     * the `where` object handed to a mocked client, so they prove the service
     * composed a filter and not that a disabled row stays hidden from a real
     * request against a real database.
     */
    it('hides a disabled product from an anonymous caller', async () => {
      await seedProductWithVariant(ctx.prisma, { name: 'Live' });
      await seedProductWithVariant(ctx.prisma, {
        name: 'Withdrawn',
        isActive: false,
      });

      const res = await http().get('/v1/products').expect(200);

      const page = res.body as Page;
      expect(page.data.map((p) => p.name)).toEqual(['Live']);
      expect(page.meta.total).toBe(1);
    });

    /**
     * The positive control, and the reason the decorator is `@OptionalAuth` and
     * not `@Public`. `@Public` returns before any token work, so the manager
     * would arrive unrecognised and see the anonymous view of their own catalog.
     */
    it('shows the disabled product to a manager who asks for it', async () => {
      await seedProductWithVariant(ctx.prisma, { name: 'Live' });
      await seedProductWithVariant(ctx.prisma, {
        name: 'Withdrawn',
        isActive: false,
      });
      const token = await signInAs(ctx, 'manager@example.com', 'manager');

      const res = await http()
        .get('/v1/products')
        .query({ includeInactive: true })
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      const names = (res.body as Page).data.map((p) => p.name);
      expect(names).toContain('Withdrawn');
      expect(names).toContain('Live');
    });

    /**
     * The detail read is asymmetric with the list on purpose, and the service
     * comment at `products.service.ts:118-124` says why: there is no flag on
     * this operation, so a manager's view is unconditional rather than asked
     * for. A test is the only thing that stops that asymmetry being tidied away.
     */
    it('answers 404 on the detail of a disabled product, and 200 to a manager', async () => {
      const { productId } = await seedProductWithVariant(ctx.prisma, {
        name: 'Withdrawn',
        isActive: false,
      });

      await http().get(`/v1/products/${productId}`).expect(404);

      const token = await signInAs(ctx, 'manager@example.com', 'manager');
      const res = await http()
        .get(`/v1/products/${productId}`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toMatchObject({ id: productId, isActive: false });
    });

    /**
     * `NOT_DELETED` is never relaxed, for any caller. Order history points at
     * the variants of products that may since have been withdrawn, so the row
     * survives while the catalog stops showing it to everyone, the manager
     * included.
     */
    it('hides a deleted product from the manager as well', async () => {
      const { productId } = await seedProductWithVariant(ctx.prisma, {
        name: 'Gone',
      });
      await ctx.prisma.product.update({
        where: { id: productId },
        data: { deletedAt: new Date() },
      });
      const token = await signInAs(ctx, 'manager@example.com', 'manager');

      await http()
        .get(`/v1/products/${productId}`)
        .set('authorization', `Bearer ${token}`)
        .expect(404);

      const res = await http()
        .get('/v1/products')
        .query({ includeInactive: true })
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      expect((res.body as Page).meta.total).toBe(0);
    });
  });

  /**
   * An integer the column cannot hold, on the two routes that need no token.
   *
   * These are unit tested at `src/common/dto/catalog-validation.spec.ts` and
   * `src/common/parse-id.pipe.spec.ts`, which prove the DTO and the pipe refuse
   * the value. Neither can prove what the caller receives, because the defect
   * was never in the validators. It was that the value passed them, reached
   * Postgres, came back as `P2020`, and fell through the exception filter as a
   * 500. Only a real request through the whole pipeline shows that.
   *
   * Measured before the bounds existed, both without a token:
   *
   *     GET /v1/products?categoryId=2147483648   500
   *     GET /v1/products/-2147483649             500
   */
  describe('an id past the int4 bounds, with no token', () => {
    beforeEach(async () => {
      await seedProductWithVariant(ctx.prisma, { name: 'In stock' });
    });

    it('answers 400 for a categoryId above the ceiling', async () => {
      await http()
        .get('/v1/products')
        .query({ categoryId: '2147483648' })
        .expect(400);
    });

    it('answers 404 for a path id below the floor', async () => {
      await http().get('/v1/products/-2147483649').expect(404);
    });

    it.each([
      ['categoryId at the ceiling', '2147483647'],
      ['an ordinary categoryId', '1'],
    ])('still answers 200 for %s, which is the control', async (_n, value) => {
      // Without these the fix could pass by refusing every request.
      await http().get('/v1/products').query({ categoryId: value }).expect(200);
    });

    it('still answers 404 for an in-range id that names no row', async () => {
      await http().get('/v1/products/2147483647').expect(404);
    });
  });
});
