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
 * The cart against a real database: the composite key, the relation filter
 * hiding a withdrawn product's line, and the live view. Every mutation is
 * asserted on the row it left behind.
 */
describe('Cart (e2e)', () => {
  let ctx: TestApp;
  let token: string;
  let fixture: CatalogFixture;

  const http = () => request(ctx.app.getHttpServer());
  const bearer = (t: string) => `Bearer ${t}`;

  const readCart = () =>
    http().get('/v1/users/me/cart').set('Authorization', bearer(token));

  const add = (variantId: number, quantity: number) =>
    http()
      .post('/v1/users/me/cart/items')
      .set('Authorization', bearer(token))
      .send({ variantId, quantity });

  const set = (variantId: number, quantity: number) =>
    http()
      .put(`/v1/users/me/cart/items/${variantId}`)
      .set('Authorization', bearer(token))
      .send({ quantity });

  const remove = (variantId: number) =>
    http()
      .delete(`/v1/users/me/cart/items/${variantId}`)
      .set('Authorization', bearer(token));

  const rowQuantity = async (variantId: number) => {
    const row = await ctx.prisma.cartItem.findFirst({
      where: { variantId },
      select: { quantity: true },
    });
    return row?.quantity ?? null;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await ensureRoles(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    fixture = await seedProductWithVariant(ctx.prisma, { stock: 7 });
    token = await signInAs(ctx, 'ana@example.com');
  });

  describe('the read', () => {
    it('answers an empty cart, not a 404, for a user who never added anything', async () => {
      const res = await readCart().expect(200);

      expect(res.body).toEqual({ items: [], subtotal: 0 });
    });

    it('answers 401 to an anonymous caller on every operation', async () => {
      await http().get('/v1/users/me/cart').expect(401);
      await http().delete('/v1/users/me/cart').expect(401);
      await http()
        .post('/v1/users/me/cart/items')
        .send({ variantId: fixture.variantId, quantity: 1 })
        .expect(401);
      await http()
        .put(`/v1/users/me/cart/items/${fixture.variantId}`)
        .send({ quantity: 1 })
        .expect(401);
      await http()
        .delete(`/v1/users/me/cart/items/${fixture.variantId}`)
        .expect(401);
    });

    it('shows one user their own lines and nobody else', async () => {
      await add(fixture.variantId, 2).expect(200);
      const other = await signInAs(ctx, 'bob@example.com');

      const res = await http()
        .get('/v1/users/me/cart')
        .set('Authorization', bearer(other))
        .expect(200);

      expect(res.body).toEqual({ items: [], subtotal: 0 });
    });
  });

  describe('add', () => {
    it('creates the line and answers the cart, priced now', async () => {
      const res = await add(fixture.variantId, 2).expect(200);

      expect(res.body).toEqual({
        items: [
          {
            variantId: fixture.variantId,
            productId: fixture.productId,
            productName: 'Fixture Tee',
            size: 'M',
            color: 'black',
            unitPrice: 1999,
            quantity: 2,
            lineTotal: 3998,
            stock: 7,
          },
        ],
        subtotal: 3998,
      });
      expect(await rowQuantity(fixture.variantId)).toBe(2);
    });

    it('adds to the line that exists, so the body is an amount and not a target', async () => {
      await add(fixture.variantId, 2).expect(200);

      const res = await add(fixture.variantId, 3).expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].quantity).toBe(5);
      expect(res.body.subtotal).toBe(9995);
      expect(await rowQuantity(fixture.variantId)).toBe(5);
    });

    // Written by hand against the service, 2026-09-03. Two adds in the same
    // moment both count: the write is an increment on the row, never a total
    // computed from a read that the other request may have overtaken.
    it('counts both of two adds that land in the same moment', async () => {
      await add(fixture.variantId, 1).expect(200);

      const [first, second] = await Promise.all([
        add(fixture.variantId, 3),
        add(fixture.variantId, 3),
      ]);

      expect([first.status, second.status]).toEqual([200, 200]);
      expect(await rowQuantity(fixture.variantId)).toBe(7);
    });

    it('answers 409 insufficient-stock above the units on hand, and the cart does not change', async () => {
      await add(fixture.variantId, 5).expect(200);

      const res = await add(fixture.variantId, 3).expect(409);

      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body).toMatchObject({
        type: 'https://tshirt.store/problems/insufficient-stock',
        title: 'Not enough stock',
        status: 409,
        detail: 'This variant has 7 units on hand and the request asks for 8.',
      });
      expect(await rowQuantity(fixture.variantId)).toBe(5);
    });

    it('carries the primary image of the product, primary first and not by id', async () => {
      const pictured = await seedProductWithVariant(ctx.prisma, {
        name: 'Pictured Tee',
        images: [
          { url: 'https://cdn.tshirt.store/products/9/side.jpg' },
          {
            url: 'https://cdn.tshirt.store/products/9/front.jpg',
            isPrimary: true,
          },
        ],
      });

      const res = await add(pictured.variantId, 1).expect(200);

      expect(res.body.items[0].imageUrl).toBe(
        'https://cdn.tshirt.store/products/9/front.jpg',
      );
    });

    it('answers 404 for a variant that does not exist', async () => {
      await add(999_999, 1).expect(404);
    });

    it('answers 404 for a variant of a disabled product', async () => {
      const disabled = await seedProductWithVariant(ctx.prisma, {
        name: 'Withdrawn Tee',
        isActive: false,
      });

      await add(disabled.variantId, 1).expect(404);
      expect(await rowQuantity(disabled.variantId)).toBeNull();
    });

    it('answers 400 with the field named for a quantity below one', async () => {
      const res = await add(fixture.variantId, 0).expect(400);

      expect(res.body.title).toBe('Validation failed');
      expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(
        'quantity',
      );
    });
  });

  describe('set', () => {
    it('writes the quantity sent, absolute, and a repeat leaves it as it is', async () => {
      await add(fixture.variantId, 5).expect(200);

      const first = await set(fixture.variantId, 1).expect(200);
      const second = await set(fixture.variantId, 1).expect(200);

      expect(first.body.items[0].quantity).toBe(1);
      expect(second.body).toEqual(first.body);
      expect(await rowQuantity(fixture.variantId)).toBe(1);
    });

    it('creates the line when it is absent', async () => {
      const res = await set(fixture.variantId, 3).expect(200);

      expect(res.body.items[0].quantity).toBe(3);
      expect(await rowQuantity(fixture.variantId)).toBe(3);
    });

    it('answers 409 insufficient-stock above the units on hand, and writes nothing', async () => {
      const res = await set(fixture.variantId, 8).expect(409);

      expect(res.body.type).toBe(
        'https://tshirt.store/problems/insufficient-stock',
      );
      expect(await rowQuantity(fixture.variantId)).toBeNull();
    });

    it('answers 404 for a variant that does not exist', async () => {
      await set(999_999, 1).expect(404);
    });
  });

  describe('delete and clear', () => {
    it('removes the line, and a second delete is 204 too', async () => {
      await add(fixture.variantId, 2).expect(200);

      await remove(fixture.variantId).expect(204);
      expect(await rowQuantity(fixture.variantId)).toBeNull();

      await remove(fixture.variantId).expect(204);
    });

    it('answers 404 for a variant that does not exist', async () => {
      await remove(999_999).expect(404);
    });

    it('answers 400 for an id that is not an integer', async () => {
      await http()
        .delete('/v1/users/me/cart/items/abc')
        .set('Authorization', bearer(token))
        .expect(400);
    });

    it('empties the cart, and an empty cart is emptied again', async () => {
      await add(fixture.variantId, 2).expect(200);

      await http()
        .delete('/v1/users/me/cart')
        .set('Authorization', bearer(token))
        .expect(204);

      const res = await readCart().expect(200);
      expect(res.body).toEqual({ items: [], subtotal: 0 });
      expect(await ctx.prisma.cartItem.count()).toBe(0);

      await http()
        .delete('/v1/users/me/cart')
        .set('Authorization', bearer(token))
        .expect(204);
    });
  });

  describe('a cart is a live view', () => {
    it("follows a manager's price change into the line and the subtotal", async () => {
      await add(fixture.variantId, 2).expect(200);
      const manager = await signInAs(ctx, 'manager@example.com', 'manager');

      await http()
        .patch(`/v1/variants/${fixture.variantId}`)
        .set('Authorization', bearer(manager))
        .send({ price: 2499 })
        .expect(200);

      const res = await readCart().expect(200);
      expect(res.body.items[0]).toMatchObject({
        unitPrice: 2499,
        lineTotal: 4998,
      });
      expect(res.body.subtotal).toBe(4998);
    });

    it('drops the line of a product disabled after it was added', async () => {
      await add(fixture.variantId, 2).expect(200);
      await ctx.prisma.product.update({
        where: { id: fixture.productId },
        data: { isActive: false },
      });

      const res = await readCart().expect(200);

      expect(res.body).toEqual({ items: [], subtotal: 0 });
      // The row is still there. The view hides it; the clear removes it.
      expect(await rowQuantity(fixture.variantId)).toBe(2);
    });

    it('still lets the user remove the line of a withdrawn product', async () => {
      await add(fixture.variantId, 2).expect(200);
      await ctx.prisma.product.update({
        where: { id: fixture.productId },
        data: { isActive: false },
      });

      await remove(fixture.variantId).expect(204);

      expect(await rowQuantity(fixture.variantId)).toBeNull();
    });

    it('reports the stock now, which can fall below the quantity held', async () => {
      await add(fixture.variantId, 5).expect(200);
      await ctx.prisma.productVariant.update({
        where: { id: fixture.variantId },
        data: { stock: 3 },
      });

      const res = await readCart().expect(200);

      expect(res.body.items[0]).toMatchObject({ quantity: 5, stock: 3 });
    });
  });
});
