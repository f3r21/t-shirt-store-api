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
 * The delivery person, Optional Features 11 and 12: the queue of shipped
 * orders, the move to `delivered`, and a history that is the caller's own
 * deliveries. Two delivery people, so "own" is provable, and a client and a
 * manager for the two ends of the rule.
 *
 * Four orders with known statuses: one shipped, one still pending, one
 * shipped that a second delivery person will take, and one of the delivery
 * person's own.
 */
describe('Deliveries (e2e)', () => {
  let ctx: TestApp;
  let fixture: CatalogFixture;
  let ana: string;
  let dana: string;
  let dario: string;
  let manager: string;
  let danaId: number;
  let shippedOrder: number;
  let pendingOrder: number;
  let secondShipped: number;

  const http = () => request(ctx.app.getHttpServer());
  const bearer = (t: string) => `Bearer ${t}`;

  const deliveries = (t: string, query = '') =>
    http().get(`/v1/deliveries${query}`).set('Authorization', bearer(t));

  const setStatus = (t: string, id: number, status: string) =>
    http()
      .patch(`/v1/orders/${id}/status`)
      .set('Authorization', bearer(t))
      .send({ status });

  const ids = (res: request.Response) =>
    (res.body.data as { id: number }[]).map((o) => o.id);

  const orderRow = (id: number) =>
    ctx.prisma.order.findUniqueOrThrow({ where: { id } });

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
    dana = await signInAs(ctx, 'dana@example.com', 'delivery_person');
    dario = await signInAs(ctx, 'dario@example.com', 'delivery_person');
    manager = await signInAs(ctx, 'manager@example.com', 'manager');
    danaId = (
      await ctx.prisma.user.findUniqueOrThrow({
        where: { email: 'dana@example.com' },
      })
    ).id;

    shippedOrder = await placeOrder(ana, 1);
    pendingOrder = await placeOrder(ana, 2);
    secondShipped = await placeOrder(ana, 3);
    await ctx.prisma.order.updateMany({
      where: { id: { in: [shippedOrder, secondShipped] } },
      data: { status: 'shipped' },
    });
  });

  describe('the queue of assigned orders', () => {
    it('lists the shipped orders and leaves a pending one out', async () => {
      const res = await deliveries(dana).expect(200);

      expect(ids(res)).toEqual([secondShipped, shippedOrder]);
      expect(res.body.meta).toEqual({ total: 2, limit: 20, offset: 0 });
      expect(ids(res)).not.toContain(pendingOrder);
    });

    it('carries the totals and the unit count, and no customer', async () => {
      const res = await deliveries(dana).expect(200);

      expect(res.body.data[1]).toEqual({
        id: shippedOrder,
        status: 'shipped',
        subtotal: 1999,
        discount: 0,
        total: 1999,
        itemCount: 1,
        createdAt: expect.any(String) as string,
      });
    });

    it('pages, and meta.total counts the whole queue', async () => {
      const res = await deliveries(dana, '?limit=1&offset=1').expect(200);

      expect(ids(res)).toEqual([shippedOrder]);
      expect(res.body.meta).toEqual({ total: 2, limit: 1, offset: 1 });
    });

    it('answers 400 naming the field for a status off the two', async () => {
      const res = await deliveries(dana, '?status=paid').expect(400);

      expect(res.body.title).toBe('Validation failed');
      expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(
        'status',
      );
    });
  });

  describe('the move to delivered', () => {
    it('moves a shipped order, writes the history row and the deliverer', async () => {
      const res = await setStatus(dana, shippedOrder, 'delivered').expect(200);

      expect(res.body.status).toBe('delivered');
      expect(
        res.body.statusHistory.map((c: { status: string }) => c.status),
      ).toEqual(['pending', 'delivered']);
      expect((await orderRow(shippedOrder)).deliveredById).toBe(danaId);
    });

    it('refuses every other status from a delivery person, with 403', async () => {
      await setStatus(dana, shippedOrder, 'cancelled').expect(403);
      // `shipped` is the status the order already holds, so this is the case
      // that proves the 403 comes from the verb and not from the transition
      // table: a delivery person holds `deliver` and neither `update` nor
      // `cancel` on somebody else's order.
      await setStatus(dana, shippedOrder, 'shipped').expect(403);
      await setStatus(dana, secondShipped, 'processing').expect(403);

      expect((await orderRow(shippedOrder)).status).toBe('shipped');
      expect((await orderRow(secondShipped)).status).toBe('shipped');
    });

    it('answers 404 on an order that has not shipped, not 403', async () => {
      await setStatus(dana, pendingOrder, 'delivered').expect(404);

      expect((await orderRow(pendingOrder)).status).toBe('pending');
    });

    // 404 and not 409: once the order is delivered it leaves the queue, and a
    // second delivery person's read rules no longer reach it at all, so the
    // ownership rule answers before the status flow does.
    it('answers 404 to a second delivery person on an order already delivered', async () => {
      await setStatus(dana, shippedOrder, 'delivered').expect(200);

      await setStatus(dario, shippedOrder, 'delivered').expect(404);
      expect((await orderRow(shippedOrder)).deliveredById).toBe(danaId);
    });

    it('refuses delivered from the client who owns the order, with 403', async () => {
      await setStatus(ana, shippedOrder, 'delivered').expect(403);

      expect((await orderRow(shippedOrder)).status).toBe('shipped');
    });

    it('lets a manager deliver, and records the manager', async () => {
      const managerId = (
        await ctx.prisma.user.findUniqueOrThrow({
          where: { email: 'manager@example.com' },
        })
      ).id;

      await setStatus(manager, shippedOrder, 'delivered').expect(200);

      expect((await orderRow(shippedOrder)).deliveredById).toBe(managerId);
    });
  });

  describe('the delivery history', () => {
    beforeEach(async () => {
      await setStatus(dana, shippedOrder, 'delivered').expect(200);
    });

    it('shows the caller their own delivery, and drops it from the queue', async () => {
      const done = await deliveries(dana, '?status=delivered').expect(200);
      expect(ids(done)).toEqual([shippedOrder]);

      const queue = await deliveries(dana).expect(200);
      expect(ids(queue)).toEqual([secondShipped]);
    });

    it('hides it from a second delivery person, who delivered nothing', async () => {
      const res = await deliveries(dario, '?status=delivered').expect(200);

      expect(res.body.data).toEqual([]);
      expect(res.body.meta.total).toBe(0);
    });

    it('shows every delivered order to a manager, with the customer', async () => {
      const res = await deliveries(manager, '?status=delivered').expect(200);

      expect(ids(res)).toEqual([shippedOrder]);
      expect(res.body.data[0].customer.email).toBe('ana@example.com');
    });

    /**
     * A courier who also shops. The history is the orders this person
     * delivered, so their own parcel is absent from it however it was
     * delivered, and they still read it as its customer. The list scopes on
     * the `deliver` rules for exactly this: the `read` rules carry the
     * caller's own orders, and that branch would put this row in the history.
     */
    it("leaves a delivery person's own purchase, delivered by someone else, out of their delivery history", async () => {
      const own = await placeOrder(dana, 1);
      await ctx.prisma.order.update({
        where: { id: own },
        data: { status: 'shipped' },
      });
      await setStatus(dario, own, 'delivered').expect(200);

      const history = await deliveries(dana, '?status=delivered').expect(200);
      expect(ids(history)).not.toContain(own);
      // The history is exactly what this person delivered, which the enclosing
      // block already made one order. Absence is the scope, not an empty list.
      expect(ids(history)).toEqual([shippedOrder]);
      expect(history.body.meta.total).toBe(1);

      // The control: the row exists, a colleague delivered it, and its owner
      // still reads it as the customer. Absence from the history is the scope
      // and not a missing order.
      expect((await orderRow(own)).status).toBe('delivered');
      const detail = await http()
        .get(`/v1/orders/${own}`)
        .set('Authorization', bearer(dana))
        .expect(200);
      expect(detail.body.id).toBe(own);
    });
  });

  describe('reading one order', () => {
    it('opens a shipped order to a delivery person through the read rule', async () => {
      const res = await http()
        .get(`/v1/orders/${shippedOrder}`)
        .set('Authorization', bearer(dana))
        .expect(200);

      expect(res.body.status).toBe('shipped');
      expect(res.body).not.toHaveProperty('customer');
    });

    it('keeps a pending order at 404 for a delivery person', async () => {
      await http()
        .get(`/v1/orders/${pendingOrder}`)
        .set('Authorization', bearer(dana))
        .expect(404);
    });

    it('opens a delivered order to the person who delivered it and nobody else', async () => {
      await setStatus(dana, shippedOrder, 'delivered').expect(200);

      await http()
        .get(`/v1/orders/${shippedOrder}`)
        .set('Authorization', bearer(dana))
        .expect(200);
      await http()
        .get(`/v1/orders/${shippedOrder}`)
        .set('Authorization', bearer(dario))
        .expect(404);
    });

    it('still shows the client their own full status history', async () => {
      await setStatus(dana, shippedOrder, 'delivered').expect(200);

      const res = await http()
        .get(`/v1/orders/${shippedOrder}`)
        .set('Authorization', bearer(ana))
        .expect(200);

      expect(
        res.body.statusHistory.map((c: { status: string }) => c.status),
      ).toEqual(['pending', 'delivered']);
    });
  });

  describe('who may reach the list at all', () => {
    it('answers 403 to a client', async () => {
      const res = await deliveries(ana).expect(403);

      expect(res.headers['content-type']).toContain('application/problem+json');
    });

    it('answers 401 to an anonymous caller, on the list and on the move', async () => {
      await http().get('/v1/deliveries').expect(401);
      await http()
        .patch(`/v1/orders/${shippedOrder}/status`)
        .send({ status: 'delivered' })
        .expect(401);
    });
  });
});
