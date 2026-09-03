import request from 'supertest';
import type { CatalogFixture, TestApp } from './app-factory';
import {
  createTestApp,
  ensureRoles,
  seedProductWithVariant,
  signInAs,
  truncateAll,
} from './app-factory';

/**
 * Likes against a real database: the composite key's idempotence, the
 * relation filter folding two liked variants into one product, and the
 * visibility rule. Every mutation is asserted on the row it left behind.
 */
describe('Likes (e2e)', () => {
  let ctx: TestApp;
  let token: string;
  let fixture: CatalogFixture;

  const IMAGE = 'https://cdn.example/products/front.jpg';

  const http = () => request(ctx.app.getHttpServer());
  const bearer = (t: string) => `Bearer ${t}`;

  const like = (variantId: number, t: string = token) =>
    http()
      .put(`/v1/variants/${variantId}/like`)
      .set('Authorization', bearer(t));

  const unlike = (variantId: number, t: string = token) =>
    http()
      .delete(`/v1/variants/${variantId}/like`)
      .set('Authorization', bearer(t));

  const list = (t: string = token) =>
    http().get('/v1/users/me/likes').set('Authorization', bearer(t));

  const rowsFor = (variantId: number) =>
    ctx.prisma.productLike.count({ where: { variantId } });

  beforeAll(async () => {
    ctx = await createTestApp();
    await ensureRoles(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    fixture = await seedProductWithVariant(ctx.prisma, {
      images: [{ url: IMAGE, isPrimary: true }],
    });
    token = await signInAs(ctx, 'ana@example.com');
  });

  describe('the like', () => {
    it('answers 204 and writes one row, and a second call leaves that one row', async () => {
      await like(fixture.variantId).expect(204);
      expect(await rowsFor(fixture.variantId)).toBe(1);

      await like(fixture.variantId).expect(204);
      expect(await rowsFor(fixture.variantId)).toBe(1);
    });

    it('answers a 404 problem document for an id that names no variant', async () => {
      const res = await like(999999).expect(404);

      expect(res.body).toMatchObject({ status: 404 });
    });

    it('answers 404 for a variant whose product is not on sale', async () => {
      const disabled = await seedProductWithVariant(ctx.prisma, {
        name: 'Withdrawn Tee',
        isActive: false,
      });

      await like(disabled.variantId).expect(404);
      expect(await rowsFor(disabled.variantId)).toBe(0);
    });
  });

  describe('the unlike', () => {
    it('answers 204 and removes the row, and again 204 with nothing to remove', async () => {
      await like(fixture.variantId).expect(204);

      await unlike(fixture.variantId).expect(204);
      expect(await rowsFor(fixture.variantId)).toBe(0);

      await unlike(fixture.variantId).expect(204);
      expect(await rowsFor(fixture.variantId)).toBe(0);
    });

    it('answers 404 for an id that names no variant', async () => {
      await unlike(999999).expect(404);
    });

    // Written by hand against the service, 2026-09-02: the unlike must remove
    // the caller's row and nobody else's.
    it("removes only the caller's row, and another client's like survives", async () => {
      await like(fixture.variantId).expect(204);
      const bob = await signInAs(ctx, 'bob@example.com');
      await like(fixture.variantId, bob).expect(204);

      const res = await unlike(fixture.variantId);
      const rows = await rowsFor(fixture.variantId);
      const bobs = await list(bob);
      const mine = await list();

      expect(res.status).toBe(204);
      expect(rows).toBe(1);
      expect(bobs.body.data).toHaveLength(1);
      expect(mine.body.data).toHaveLength(0);
    });
  });

  describe('the list', () => {
    it('lists a product once when two of its variants are liked, in the product list shape', async () => {
      const second = await ctx.prisma.productVariant.create({
        data: {
          productId: fixture.productId,
          size: 'L',
          color: 'black',
          priceCents: 1499,
          stock: 3,
        },
      });
      await like(fixture.variantId).expect(204);
      await like(second.id).expect(204);

      const res = await list().expect(200);

      expect(res.body).toEqual({
        data: [
          {
            id: fixture.productId,
            name: 'Fixture Tee',
            isActive: true,
            createdAt: expect.any(String) as string,
            priceFrom: 1499,
            primaryImageUrl: IMAGE,
          },
        ],
        meta: { total: 1, limit: 20, offset: 0 },
      });
    });

    it("hides another client's likes, and a product disabled after the like", async () => {
      await like(fixture.variantId).expect(204);
      const bob = await signInAs(ctx, 'bob@example.com');

      const theirs = await list(bob).expect(200);
      expect(theirs.body).toEqual({
        data: [],
        meta: { total: 0, limit: 20, offset: 0 },
      });

      await ctx.prisma.product.update({
        where: { id: fixture.productId },
        data: { isActive: false },
      });

      const mine = await list().expect(200);
      expect(mine.body).toEqual({
        data: [],
        meta: { total: 0, limit: 20, offset: 0 },
      });
      // The like survives the product being disabled. The list hides it.
      expect(await rowsFor(fixture.variantId)).toBe(1);
    });
  });

  describe('anonymous', () => {
    it('answers 401 on every operation', async () => {
      await http().put(`/v1/variants/${fixture.variantId}/like`).expect(401);
      await http().delete(`/v1/variants/${fixture.variantId}/like`).expect(401);
      await http().get('/v1/users/me/likes').expect(401);
    });
  });
});
