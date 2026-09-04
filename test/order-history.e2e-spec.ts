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
 * Order history: a client sees their own orders and nobody else's, then the
 * five filters, the pagination, and the manager's view. Three orders with
 * known instants and totals, so every filter has a boundary.
 */
describe('Order history (e2e)', () => {
  let ctx: TestApp;
  let fixture: CatalogFixture;
  let ana: string;
  let bob: string;
  let manager: string;
  let anaId: number;
  let anaOld: number;
  let anaPaid: number;
  let bobOrder: number;

  const http = () => request(ctx.app.getHttpServer());
  const bearer = (t: string) => `Bearer ${t}`;

  const myOrders = (t: string, query = '') =>
    http().get(`/v1/users/me/orders${query}`).set('Authorization', bearer(t));

  const allOrders = (t: string, query = '') =>
    http().get(`/v1/orders${query}`).set('Authorization', bearer(t));

  const ids = (res: request.Response) =>
    (res.body.data as { id: number }[]).map((o) => o.id);

  const placeOrder = async (t: string, quantity: number): Promise<number> => {
    await http()
      .post('/v1/users/me/cart/items')
      .set('Authorization', bearer(t))
      .send({ variantId: fixture.variantId, quantity })
      .expect(200);
    const res = await http()
      .post('/v1/orders')
      .set('Authorization', bearer(t))
      .expect(201);
    return res.body.id as number;
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
    fixture = await seedProductWithVariant(ctx.prisma, { stock: 100 });
    ana = await signInAs(ctx, 'ana@example.com');
    bob = await signInAs(ctx, 'bob@example.com');
    manager = await signInAs(ctx, 'manager@example.com', 'manager');
    anaId = (
      await ctx.prisma.user.findUniqueOrThrow({
        where: { email: 'ana@example.com' },
      })
    ).id;

    // Ana: one unit on 1 August, pending, 1999; two units on 15 August at
    // noon, paid, 3998. Bob: three units on 1 September, pending, 5997.
    anaOld = await placeOrder(ana, 1);
    anaPaid = await placeOrder(ana, 2);
    bobOrder = await placeOrder(bob, 3);
    await ctx.prisma.order.update({
      where: { id: anaOld },
      data: { createdAt: new Date('2026-08-01T00:00:00Z') },
    });
    await ctx.prisma.order.update({
      where: { id: anaPaid },
      data: {
        createdAt: new Date('2026-08-15T12:00:00Z'),
        status: 'paid',
        paymentMethod: 'payment_intent',
      },
    });
    await ctx.prisma.order.update({
      where: { id: bobOrder },
      data: { createdAt: new Date('2026-09-01T00:00:00Z') },
    });
  });

  describe('a client sees their own orders and nobody else', () => {
    it('lists only the orders of the caller, newest first, with no customer', async () => {
      const res = await myOrders(ana).expect(200);

      expect(ids(res)).toEqual([anaPaid, anaOld]);
      expect(res.body.meta).toEqual({ total: 2, limit: 20, offset: 0 });
      expect(res.body.data[0]).toEqual({
        id: anaPaid,
        status: 'paid',
        subtotal: 3998,
        discount: 0,
        total: 3998,
        itemCount: 2,
        paymentMethod: 'payment_intent',
        createdAt: '2026-08-15T12:00:00.000Z',
      });
    });

    it("carries the payment method on a paid order's list entry", async () => {
      const res = await myOrders(ana).expect(200);

      expect(res.body.data[0].paymentMethod).toBe('payment_intent');
      // The control: the older order is pending, and an order no payment
      // reached carries no method at all, the absence `getOrder` also answers.
      expect(res.body.data[1]).not.toHaveProperty('paymentMethod');
    });

    it("answers 404, not 403, for another client's order id", async () => {
      await http()
        .get(`/v1/orders/${bobOrder}`)
        .set('Authorization', bearer(ana))
        .expect(404);
      await http()
        .patch(`/v1/orders/${bobOrder}/status`)
        .set('Authorization', bearer(ana))
        .send({ status: 'cancelled' })
        .expect(404);
    });

    it('reads its own order in full, with lines, history and the payment method', async () => {
      const res = await http()
        .get(`/v1/orders/${anaPaid}`)
        .set('Authorization', bearer(ana))
        .expect(200);

      expect(res.body).toMatchObject({
        id: anaPaid,
        status: 'paid',
        total: 3998,
        paymentMethod: 'payment_intent',
      });
      expect(res.body.items).toHaveLength(1);
      expect(res.body.statusHistory[0].status).toBe('pending');
      expect(res.body).not.toHaveProperty('customer');
    });

    it('cannot list every order', async () => {
      const res = await allOrders(ana).expect(403);

      expect(res.headers['content-type']).toContain('application/problem+json');
    });

    it('answers 401 to an anonymous caller on both lists', async () => {
      await http().get('/v1/users/me/orders').expect(401);
      await http().get('/v1/orders').expect(401);
      await http().get(`/v1/orders/${anaOld}`).expect(401);
    });
  });

  describe('a manager', () => {
    it('reads any order, with the client who placed it', async () => {
      const res = await http()
        .get(`/v1/orders/${bobOrder}`)
        .set('Authorization', bearer(manager))
        .expect(200);

      expect(res.body.customer).toEqual({
        id: expect.any(Number) as number,
        email: 'bob@example.com',
        firstName: 'Test',
        lastName: 'Account',
      });
    });

    it('lists every order newest first, each with its customer', async () => {
      const res = await allOrders(manager).expect(200);

      expect(ids(res)).toEqual([bobOrder, anaPaid, anaOld]);
      expect(res.body.meta.total).toBe(3);
      expect(
        res.body.data.map(
          (o: { customer: { email: string } }) => o.customer.email,
        ),
      ).toEqual(['bob@example.com', 'ana@example.com', 'ana@example.com']);
    });

    it('narrows the list to one client with userId', async () => {
      const res = await allOrders(manager, `?userId=${anaId}`).expect(200);

      expect(ids(res)).toEqual([anaPaid, anaOld]);
      expect(res.body.meta.total).toBe(2);
    });
  });

  describe('the filters', () => {
    it('by status', async () => {
      const res = await myOrders(ana, '?status=paid').expect(200);

      expect(ids(res)).toEqual([anaPaid]);
    });

    it('by date range: createdFrom is inclusive and createdTo is exclusive', async () => {
      const from = await myOrders(
        ana,
        '?createdFrom=2026-08-15T12:00:00Z',
      ).expect(200);
      expect(ids(from)).toEqual([anaPaid]);

      const to = await myOrders(ana, '?createdTo=2026-08-15T12:00:00Z').expect(
        200,
      );
      expect(ids(to)).toEqual([anaOld]);

      const day = await myOrders(
        ana,
        '?createdFrom=2026-08-15T00:00:00Z&createdTo=2026-08-16T00:00:00Z',
      ).expect(200);
      expect(ids(day)).toEqual([anaPaid]);
    });

    it('by price range, on the total in minor units', async () => {
      expect(ids(await myOrders(ana, '?minTotal=3000').expect(200))).toEqual([
        anaPaid,
      ]);
      expect(ids(await myOrders(ana, '?maxTotal=2000').expect(200))).toEqual([
        anaOld,
      ]);
      expect(
        ids(await myOrders(ana, '?minTotal=1999&maxTotal=1999').expect(200)),
      ).toEqual([anaOld]);
      expect(ids(await myOrders(ana, '?minTotal=4000').expect(200))).toEqual(
        [],
      );
    });

    it('pages, and meta.total counts the whole filtered set', async () => {
      const res = await myOrders(ana, '?limit=1&offset=1').expect(200);

      expect(ids(res)).toEqual([anaOld]);
      expect(res.body.meta).toEqual({ total: 2, limit: 1, offset: 1 });
    });

    it('applies the same filters for the manager', async () => {
      const res = await allOrders(
        manager,
        '?status=pending&minTotal=5000',
      ).expect(200);

      expect(ids(res)).toEqual([bobOrder]);
    });

    it('answers 400 naming the field for a bad filter', async () => {
      const bad = async (query: string, field: string) => {
        const res = await myOrders(ana, query).expect(400);
        expect(res.body.title).toBe('Validation failed');
        expect(
          res.body.errors.map((e: { field: string }) => e.field),
        ).toContain(field);
      };

      await bad('?createdFrom=yesterday', 'createdFrom');
      await bad('?status=refunded', 'status');
      await bad('?minTotal=-1', 'minTotal');
      await bad('?maxTotal=1.5', 'maxTotal');
    });
  });
});
