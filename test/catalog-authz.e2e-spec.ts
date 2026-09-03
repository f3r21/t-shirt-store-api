import request from 'supertest';
import type { CatalogFixture, TestApp } from './app-factory';
import {
  createTestApp,
  ensureRoles,
  seedOrderLineFor,
  seedProductWithVariant,
  signInAs,
  truncateAll,
} from './app-factory';

/**
 * Who may write to the catalog, end to end, on every route that writes to it.
 *
 * Six of the seven catalog mutations were reachable by no test in either tier
 * before this file existed. `roles.e2e-spec.ts` covers the seventh, `POST
 * /products`, and it covers it to prove the guard mechanism rather than the
 * route, which is why it stays as it is and this suite sits beside it.
 *
 * **Two attacks, and each half of this suite catches exactly one.**
 *
 * Delete `@Roles('manager')` from a handler and it carries no marker at all.
 * `roles.guard.ts:78-80` denies by default, so every caller is refused, the
 * client is still 403 and only the manager case changes. The positive controls
 * are what turn red.
 *
 * Widen it to `@Roles(...ROLE_NAMES)` and every signed-in caller is let through.
 * The manager still succeeds and only the client case changes. The 403 block is
 * what turns red.
 *
 * Neither half is redundant, and neither one alone would have caught both.
 *
 * The manager cases assert the row the request left behind and not only the
 * status code, because a handler that answered 200 and wrote nothing would
 * satisfy a status assertion.
 */
describe('Catalog authorization (e2e)', () => {
  let ctx: TestApp;
  let fixture: CatalogFixture;

  const http = () => request(ctx.app.getHttpServer());

  type Method = 'post' | 'patch' | 'delete';

  interface Mutation {
    name: string;
    method: Method;
    path: (f: CatalogFixture) => string;
    body?: Record<string, unknown>;
  }

  /** Every catalog write except `POST /products`, which `roles.e2e-spec.ts` owns. */
  const MUTATIONS: Mutation[] = [
    {
      name: 'PATCH /products/{id}',
      method: 'patch',
      path: (f) => `/v1/products/${f.productId}`,
      body: { name: 'Renamed' },
    },
    {
      name: 'DELETE /products/{id}',
      method: 'delete',
      path: (f) => `/v1/products/${f.productId}`,
    },
    {
      name: 'POST /products/{id}/variants',
      method: 'post',
      path: (f) => `/v1/products/${f.productId}/variants`,
      body: { size: 'L', color: 'red', price: 2999, stock: 4 },
    },
    {
      name: 'PATCH /variants/{id}',
      method: 'patch',
      path: (f) => `/v1/variants/${f.variantId}`,
      body: { price: 2499 },
    },
    {
      name: 'DELETE /variants/{id}',
      method: 'delete',
      path: (f) => `/v1/variants/${f.variantId}`,
    },
    {
      name: 'PATCH /variants/{id}/stock',
      method: 'patch',
      path: (f) => `/v1/variants/${f.variantId}/stock`,
      body: { stock: 3 },
    },
  ];

  function call(m: Mutation, token?: string): request.Test {
    const req = http()[m.method](m.path(fixture));
    if (token) {
      req.set('authorization', `Bearer ${token}`);
    }
    return m.body ? req.send(m.body) : req;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await ensureRoles(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    fixture = await seedProductWithVariant(ctx.prisma);
  });

  /**
   * 401 and not 403, which is the assertion that pins the guard order. Only a
   * token guard running before the roles guard can answer 401 here.
   */
  it.each(MUTATIONS)('answers 401 to an anonymous caller: $name', async (m) => {
    await call(m).expect(401);
  });

  it.each(MUTATIONS)('answers 403 to a signed-in client: $name', async (m) => {
    const token = await signInAs(ctx, 'client@example.com');

    const res = await call(m, token).expect(403);

    expect(res.type).toBe('application/problem+json');
    expect(res.body).toMatchObject({ status: 403 });
  });

  describe('a manager is let through, and the write lands', () => {
    let token: string;

    beforeEach(async () => {
      token = await signInAs(ctx, 'manager@example.com', 'manager');
    });

    it('renames a product', async () => {
      const res = await call(MUTATIONS[0], token).expect(200);

      expect(res.body).toMatchObject({
        id: fixture.productId,
        name: 'Renamed',
      });
      const row = await ctx.prisma.product.findUnique({
        where: { id: fixture.productId },
      });
      expect(row?.name).toBe('Renamed');
    });

    it('soft deletes a product', async () => {
      await call(MUTATIONS[1], token).expect(204);

      // Soft, not hard: order history points at the variants of products that
      // may since have been withdrawn, so the row survives with `deletedAt` set.
      const row = await ctx.prisma.product.findUnique({
        where: { id: fixture.productId },
      });
      expect(row).not.toBeNull();
      expect(row?.deletedAt).toBeInstanceOf(Date);
    });

    /**
     * Disabling through the API, which the contract prescribes as `isActive:
     * false` on PATCH. The visibility tests in `catalog-read.e2e-spec.ts` seed
     * the flag straight into the database, so until this test nothing proved
     * that the request a manager actually sends reaches the column and that
     * the storefront then hides the product. The manager's own view is the
     * control: hidden from the shopper, still there for the person who did it.
     */
    it('disables a product through PATCH, and the storefront hides it', async () => {
      const res = await http()
        .patch(`/v1/products/${fixture.productId}`)
        .set('authorization', `Bearer ${token}`)
        .send({ isActive: false })
        .expect(200);
      expect(res.body).toMatchObject({
        id: fixture.productId,
        isActive: false,
      });

      const shopper = await http().get('/v1/products').expect(200);
      expect(
        (shopper.body as { data: { id: number }[] }).data.map((p) => p.id),
      ).not.toContain(fixture.productId);
      await http().get(`/v1/products/${fixture.productId}`).expect(404);

      const manager = await http()
        .get('/v1/products')
        .query({ includeInactive: true })
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect(
        (manager.body as { data: { id: number }[] }).data.map((p) => p.id),
      ).toContain(fixture.productId);
    });

    it('creates a variant', async () => {
      const res = await call(MUTATIONS[2], token).expect(201);

      expect(res.headers.location).toMatch(/^\/v1\/variants\/\d+$/);
      const rows = await ctx.prisma.productVariant.findMany({
        where: { productId: fixture.productId },
        orderBy: { id: 'asc' },
      });
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        size: 'L',
        color: 'red',
        priceCents: 2999,
        stock: 4,
      });
    });

    it('updates a variant', async () => {
      const res = await call(MUTATIONS[3], token).expect(200);

      expect(res.body).toMatchObject({ id: fixture.variantId, price: 2499 });
      const row = await ctx.prisma.productVariant.findUnique({
        where: { id: fixture.variantId },
      });
      expect(row?.priceCents).toBe(2499);
    });

    it('deletes a variant', async () => {
      await call(MUTATIONS[4], token).expect(204);

      // A variant is deleted for real, unlike a product, and only while nothing
      // points at it. The 409 for the other case is two tests below.
      const row = await ctx.prisma.productVariant.findUnique({
        where: { id: fixture.variantId },
      });
      expect(row).toBeNull();
    });

    /**
     * The contract's 409 at `openapi.yaml:1084`, run against a real order row.
     *
     * No operation creates an order this week, so the rows go in directly. That
     * is what makes this a test rather than a promise: without it the branch is
     * unreachable, and the schema's own `onDelete: Restrict` would answer an
     * unmapped 500 the first day an order existed.
     */
    it('refuses to delete a variant an order points at, and keeps the row', async () => {
      await seedOrderLineFor(ctx.prisma, fixture, 'manager@example.com');

      const res = await call(MUTATIONS[4], token).expect(409);

      expect(res.type).toBe('application/problem+json');
      expect(res.body).toMatchObject({
        status: 409,
        detail:
          'This variant appears in an order. Set its stock to zero instead.',
      });

      const row = await ctx.prisma.productVariant.findUnique({
        where: { id: fixture.variantId },
      });
      expect(row).not.toBeNull();
    });

    it('sets the stock of a variant', async () => {
      const res = await call(MUTATIONS[5], token).expect(200);

      expect(res.body).toMatchObject({ id: fixture.variantId, stock: 3 });
      const row = await ctx.prisma.productVariant.findUnique({
        where: { id: fixture.variantId },
      });
      expect(row?.stock).toBe(3);
    });

    /**
     * `minProperties: 1`, which both update operations declare and neither
     * enforced. An empty body answered 200 having written nothing, which tells
     * the caller a change landed.
     *
     * The assertion is on the status and on the row, because a handler that
     * answered 400 and wrote anyway would satisfy the first half alone.
     */
    describe.each([
      ['a product', (f: CatalogFixture) => `/v1/products/${f.productId}`],
      ['a variant', (f: CatalogFixture) => `/v1/variants/${f.variantId}`],
    ])('an empty PATCH body on %s', (_label, path) => {
      it('answers 400 and changes nothing', async () => {
        const before = await ctx.prisma.product.findUnique({
          where: { id: fixture.productId },
          include: { variants: true },
        });

        const res = await http()
          .patch(path(fixture))
          .set('authorization', `Bearer ${token}`)
          .send({})
          .expect(400);

        expect(res.type).toBe('application/problem+json');
        expect(res.body).toMatchObject({
          status: 400,
          detail: 'Send at least one field.',
        });

        const after = await ctx.prisma.product.findUnique({
          where: { id: fixture.productId },
          include: { variants: true },
        });
        expect(after).toEqual(before);
      });
    });
  });
});
