import request from 'supertest';
import {
  CatalogFixture,
  createTestApp,
  ensureRoles,
  seedProductWithVariant,
  signInAs,
  truncateAll,
  TestApp,
} from './app-factory';

/**
 * Checkout, end to end: cart to order, then the order through its statuses.
 *
 * The Week 3 & 4 page names this as the second of the three flows the suite
 * owes, and says what to assert: the response, the order's status in the
 * database, and the stock afterwards, "the one people skip". Until the payment
 * webhook lands in block 3 the stock assertion is that it did **not** move,
 * because the contract says an unpaid order reserves nothing. Block 3 extends
 * this file with the payment and the decrement rather than starting another.
 *
 * Every mutation is asserted on the rows it left behind, not only the body.
 */
describe('Checkout (e2e)', () => {
  let ctx: TestApp;
  let token: string;
  let fixture: CatalogFixture;

  const http = () => request(ctx.app.getHttpServer());
  const bearer = (t: string) => `Bearer ${t}`;

  const addToCart = (t: string, variantId: number, quantity: number) =>
    http()
      .post('/v1/users/me/cart/items')
      .set('Authorization', bearer(t))
      .send({ variantId, quantity });

  const createOrder = (t: string) =>
    http().post('/v1/orders').set('Authorization', bearer(t));

  const setStatus = (t: string, id: number, status: string) =>
    http()
      .patch(`/v1/orders/${id}/status`)
      .set('Authorization', bearer(t))
      .send({ status });

  const orderRow = (id: number) =>
    ctx.prisma.order.findUniqueOrThrow({
      where: { id },
      include: { items: true, statusHistory: { orderBy: { id: 'asc' } } },
    });

  const stockOf = async (variantId: number) =>
    (
      await ctx.prisma.productVariant.findUniqueOrThrow({
        where: { id: variantId },
      })
    ).stock;

  /** Two of the fixture variant, ordered. Returns the order id. */
  const placeOrder = async (t: string, quantity = 2): Promise<number> => {
    await addToCart(t, fixture.variantId, quantity).expect(200);
    const res = await createOrder(t).expect(201);
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
    ctx.stripe.clear();
    fixture = await seedProductWithVariant(ctx.prisma, { stock: 7 });
    token = await signInAs(ctx, 'ana@example.com');
  });

  describe('placing the order', () => {
    it('turns the cart into a pending order, empties the cart, and leaves the stock alone', async () => {
      await addToCart(token, fixture.variantId, 2).expect(200);

      const res = await createOrder(token).expect(201);

      expect(res.headers.location).toBe(`/v1/orders/${res.body.id}`);
      expect(res.body).toEqual({
        id: expect.any(Number) as number,
        status: 'pending',
        subtotal: 3998,
        total: 3998,
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
          },
        ],
        createdAt: expect.any(String) as string,
        statusHistory: [
          { status: 'pending', changedAt: expect.any(String) as string },
        ],
      });

      const row = await orderRow(res.body.id as number);
      expect(row.status).toBe('pending');
      expect(row.paymentMethod).toBeNull();
      expect(row.subtotalCents).toBe(3998);
      expect(row.items).toEqual([
        expect.objectContaining({
          variantId: fixture.variantId,
          productName: 'Fixture Tee',
          unitPriceCents: 1999,
          quantity: 2,
        }),
      ]);
      expect(row.statusHistory.map((h) => h.status)).toEqual(['pending']);
      expect(await ctx.prisma.cartItem.count()).toBe(0);
      // The assertion the Week 3 & 4 page says people skip. Here it is that
      // nothing moved: an unpaid order reserves nothing.
      expect(await stockOf(fixture.variantId)).toBe(7);
    });

    it('answers 409 for an empty cart, and creates nothing', async () => {
      const res = await createOrder(token).expect(409);

      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body).toMatchObject({
        status: 409,
        detail: 'The cart is empty.',
      });
      expect(await ctx.prisma.order.count()).toBe(0);
    });

    it('answers 409 insufficient-stock when the shelf fell under a line, and creates nothing', async () => {
      await addToCart(token, fixture.variantId, 5).expect(200);
      await ctx.prisma.productVariant.update({
        where: { id: fixture.variantId },
        data: { stock: 3 },
      });

      const res = await createOrder(token).expect(409);

      expect(res.body).toMatchObject({
        type: 'https://tshirt.store/problems/insufficient-stock',
        title: 'Not enough stock',
        detail: 'This variant has 3 units on hand and the request asks for 5.',
      });
      expect(await ctx.prisma.order.count()).toBe(0);
      // The cart is untouched, so the client can fix the line and retry.
      expect(await ctx.prisma.cartItem.count()).toBe(1);
    });

    it('records what the client saw: a later rename and reprice do not reach the order', async () => {
      const id = await placeOrder(token, 1);
      const manager = await signInAs(ctx, 'manager@example.com', 'manager');
      await http()
        .patch(`/v1/products/${fixture.productId}`)
        .set('Authorization', bearer(manager))
        .send({ name: 'Renamed Tee' })
        .expect(200);
      await http()
        .patch(`/v1/variants/${fixture.variantId}`)
        .set('Authorization', bearer(manager))
        .send({ price: 2499 })
        .expect(200);

      const res = await http()
        .get(`/v1/orders/${id}`)
        .set('Authorization', bearer(token))
        .expect(200);

      expect(res.body.items[0]).toMatchObject({
        productName: 'Fixture Tee',
        unitPrice: 1999,
      });
      expect(res.body.total).toBe(1999);
    });

    it('leaves out the line of a withdrawn product, and still empties the cart', async () => {
      const withdrawn = await seedProductWithVariant(ctx.prisma, {
        name: 'Soon Withdrawn Tee',
      });
      await addToCart(token, fixture.variantId, 2).expect(200);
      await addToCart(token, withdrawn.variantId, 1).expect(200);
      await ctx.prisma.product.update({
        where: { id: withdrawn.productId },
        data: { isActive: false },
      });

      const res = await createOrder(token).expect(201);

      expect(
        res.body.items.map((i: { variantId: number }) => i.variantId),
      ).toEqual([fixture.variantId]);
      expect(res.body.total).toBe(3998);
      expect(await ctx.prisma.cartItem.count()).toBe(0);
    });

    it('cannot place the same cart twice: the second call finds it empty', async () => {
      await placeOrder(token);

      await createOrder(token).expect(409);
      expect(await ctx.prisma.order.count()).toBe(1);
    });

    it('answers 401 to an anonymous caller', async () => {
      await http().post('/v1/orders').expect(401);
    });
  });

  describe('the status flow', () => {
    it('lets a client cancel a pending order, and the history grows', async () => {
      const id = await placeOrder(token);

      const res = await setStatus(token, id, 'cancelled').expect(200);

      expect(res.body.status).toBe('cancelled');
      expect(
        res.body.statusHistory.map((h: { status: string }) => h.status),
      ).toEqual(['pending', 'cancelled']);
      const row = await orderRow(id);
      expect(row.status).toBe('cancelled');
      expect(row.statusHistory.map((h) => h.status)).toEqual([
        'pending',
        'cancelled',
      ]);
    });

    it('refuses a client who tries to advance an order, with 403', async () => {
      const id = await placeOrder(token);

      const res = await setStatus(token, id, 'processing').expect(403);

      expect(res.headers['content-type']).toContain('application/problem+json');
      expect((await orderRow(id)).status).toBe('pending');
    });

    it('refuses a manager who tries to process an unpaid order, with 409', async () => {
      const id = await placeOrder(token);
      const manager = await signInAs(ctx, 'manager@example.com', 'manager');

      const res = await setStatus(manager, id, 'processing').expect(409);

      expect(res.body.detail).toBe(
        'An order in status pending cannot move to processing.',
      );
      expect((await orderRow(id)).status).toBe('pending');
    });

    it('lets a manager take a paid order to processing and then shipped, one history row each', async () => {
      const id = await placeOrder(token);
      // What the payment webhook will write in block 3, done by hand here.
      await ctx.prisma.order.update({
        where: { id },
        data: {
          status: 'paid',
          paymentMethod: 'payment_intent',
          statusHistory: { create: { status: 'paid' } },
        },
      });
      const manager = await signInAs(ctx, 'manager@example.com', 'manager');

      const processing = await setStatus(manager, id, 'processing').expect(200);
      expect(processing.body.status).toBe('processing');
      expect(processing.body.paymentMethod).toBe('payment_intent');
      expect(processing.body.customer).toMatchObject({
        email: 'ana@example.com',
      });

      const shipped = await setStatus(manager, id, 'shipped').expect(200);
      expect(shipped.body.status).toBe('shipped');

      const row = await orderRow(id);
      expect(row.statusHistory.map((h) => h.status)).toEqual([
        'pending',
        'paid',
        'processing',
        'shipped',
      ]);
    });

    it('refuses a cancel after the order shipped, with the order-not-cancellable type', async () => {
      const id = await placeOrder(token);
      await ctx.prisma.order.update({
        where: { id },
        data: { status: 'shipped' },
      });

      const res = await setStatus(token, id, 'cancelled').expect(409);

      expect(res.body).toMatchObject({
        type: 'https://tshirt.store/problems/order-not-cancellable',
        title: 'Order cannot be cancelled',
        status: 409,
        detail: 'This order already shipped.',
      });
      expect((await orderRow(id)).status).toBe('shipped');
    });

    it('answers 400 naming the field for a status nobody may send', async () => {
      const id = await placeOrder(token);

      const res = await setStatus(token, id, 'paid').expect(400);

      expect(res.body.title).toBe('Validation failed');
      expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(
        'status',
      );
    });

    it("answers 404 for another client's order, and leaves it alone", async () => {
      const id = await placeOrder(token);
      const other = await signInAs(ctx, 'bob@example.com');

      await setStatus(other, id, 'cancelled').expect(404);

      expect((await orderRow(id)).status).toBe('pending');
    });
  });

  /**
   * The payment, through the stub for the API calls and the real signer for
   * the webhook. The secret is the one `setup-e2e.ts` sets, so a body signed
   * here verifies in the server the way a body signed by Stripe would.
   */
  describe('paying', () => {
    const SECRET = process.env.STRIPE_WEBHOOK_SECRET as string;

    const event = (
      type: string,
      orderId: number | string | undefined,
      id = 'evt_1',
    ) =>
      JSON.stringify({
        id,
        object: 'event',
        type,
        data: {
          object: {
            id: 'obj_1',
            metadata: orderId === undefined ? {} : { orderId: String(orderId) },
          },
        },
      });

    const deliver = (payload: string, secret = SECRET) =>
      http()
        .post('/v1/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set(
          'Stripe-Signature',
          ctx.stripe.webhooks.generateTestHeaderString({ payload, secret }),
        )
        .send(payload);

    const createIntent = (t: string, id: number) =>
      http().post(`/v1/orders/${id}/payments`).set('Authorization', bearer(t));

    const createLink = (t: string, variantId: number, quantity: number) =>
      http()
        .post('/v1/payment-links')
        .set('Authorization', bearer(t))
        .send({ variantId, quantity });

    const eventsRecorded = () => ctx.prisma.stripeEvent.count();

    it('pays a cart: order, intent, signed event, then the order is paid and the stock is down', async () => {
      const id = await placeOrder(token);

      const intent = await createIntent(token, id).expect(201);
      expect(intent.body).toEqual({
        orderId: id,
        clientSecret: 'pi_e2e_secret_x',
        amount: 3998,
      });
      // The amount came from the order, and the order id rode along.
      expect(ctx.stripe.intents[0]).toMatchObject({
        amount: 3998,
        currency: 'usd',
        metadata: { orderId: String(id) },
      });

      await deliver(event('payment_intent.succeeded', id)).expect(200);

      const row = await orderRow(id);
      expect(row.status).toBe('paid');
      expect(row.paymentMethod).toBe('payment_intent');
      expect(row.statusHistory.map((h) => h.status)).toEqual([
        'pending',
        'paid',
      ]);
      // The assertion the Week 3 & 4 page says people skip.
      expect(await stockOf(fixture.variantId)).toBe(5);

      const read = await http()
        .get(`/v1/orders/${id}`)
        .set('Authorization', bearer(token))
        .expect(200);
      expect(read.body).toMatchObject({
        status: 'paid',
        paymentMethod: 'payment_intent',
      });
    });

    it('applies an event once: a replay is 200 and moves nothing', async () => {
      const id = await placeOrder(token);
      const payload = event('payment_intent.succeeded', id);
      await deliver(payload).expect(200);

      await deliver(payload).expect(200);

      expect(await stockOf(fixture.variantId)).toBe(5);
      const row = await orderRow(id);
      expect(row.statusHistory.filter((h) => h.status === 'paid')).toHaveLength(
        1,
      );
      expect(await eventsRecorded()).toBe(1);
    });

    it('a second event for an order already paid is 200 and changes nothing', async () => {
      const id = await placeOrder(token);
      await deliver(event('payment_intent.succeeded', id, 'evt_1')).expect(200);

      await deliver(event('payment_intent.succeeded', id, 'evt_2')).expect(200);

      expect(await stockOf(fixture.variantId)).toBe(5);
      expect((await orderRow(id)).statusHistory).toHaveLength(2);
      expect(await eventsRecorded()).toBe(2);
    });

    it('refuses a body that changed after it was signed, with 400', async () => {
      const id = await placeOrder(token);
      const payload = event('payment_intent.succeeded', id);
      const header = ctx.stripe.webhooks.generateTestHeaderString({
        payload,
        secret: SECRET,
      });

      const res = await http()
        .post('/v1/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', header)
        .send(payload.replace('"evt_1"', '"evt_9"'))
        .expect(400);

      expect(res.headers['content-type']).toContain('application/problem+json');
      expect((await orderRow(id)).status).toBe('pending');
      expect(await stockOf(fixture.variantId)).toBe(7);
      expect(await eventsRecorded()).toBe(0);
    });

    it('refuses a signature made with another secret, and a missing header', async () => {
      const id = await placeOrder(token);
      const payload = event('payment_intent.succeeded', id);

      await deliver(payload, 'whsec_someone_else').expect(400);
      await http()
        .post('/v1/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(400);

      expect((await orderRow(id)).status).toBe('pending');
    });

    it('answers 200 for an event kind it does not handle, and records nothing', async () => {
      const id = await placeOrder(token);

      await deliver(event('charge.succeeded', id)).expect(200);

      expect((await orderRow(id)).status).toBe('pending');
      expect(await eventsRecorded()).toBe(0);
    });

    it('answers 200 for an event that names no order, and records it', async () => {
      await deliver(event('payment_intent.succeeded', undefined)).expect(200);

      expect(await eventsRecorded()).toBe(1);
      expect(await ctx.prisma.order.count()).toBe(0);
    });

    it('a cancel that landed first wins: the payment does not reopen the order', async () => {
      const id = await placeOrder(token);
      await setStatus(token, id, 'cancelled').expect(200);

      await deliver(event('payment_intent.succeeded', id)).expect(200);

      const row = await orderRow(id);
      expect(row.status).toBe('cancelled');
      expect(row.paymentMethod).toBeNull();
      expect(await stockOf(fixture.variantId)).toBe(7);
      expect(await eventsRecorded()).toBe(1);
    });

    it('floors the stock at zero when the units are gone by the time the payment lands', async () => {
      const id = await placeOrder(token);
      await ctx.prisma.productVariant.update({
        where: { id: fixture.variantId },
        data: { stock: 1 },
      });

      await deliver(event('payment_intent.succeeded', id)).expect(200);

      expect((await orderRow(id)).status).toBe('paid');
      expect(await stockOf(fixture.variantId)).toBe(0);
    });

    it('refuses an intent for an order that is not pending, with 409', async () => {
      const id = await placeOrder(token);
      await setStatus(token, id, 'cancelled').expect(200);

      const res = await createIntent(token, id).expect(409);

      expect(res.body.detail).toBe(
        'An order in status cancelled cannot be paid.',
      );
      expect(ctx.stripe.intents).toHaveLength(0);
    });

    it("refuses an intent for another client's order, with 404", async () => {
      const id = await placeOrder(token);
      const other = await signInAs(ctx, 'bob@example.com');

      await createIntent(other, id).expect(404);
      expect(ctx.stripe.intents).toHaveLength(0);
    });

    it('refuses an intent when a line is above the stock, before Stripe is asked', async () => {
      const id = await placeOrder(token);
      await ctx.prisma.productVariant.update({
        where: { id: fixture.variantId },
        data: { stock: 1 },
      });

      const res = await createIntent(token, id).expect(409);

      expect(res.body.type).toBe(
        'https://tshirt.store/problems/insufficient-stock',
      );
      expect(ctx.stripe.intents).toHaveLength(0);
    });

    it('sells one product through a link: a pending order, the id in the link, no stock moved', async () => {
      const res = await createLink(token, fixture.variantId, 2).expect(201);

      const orderId = res.body.orderId as number;
      expect(res.headers.location).toBe(`/v1/orders/${orderId}`);
      expect(res.body).toEqual({
        orderId,
        url: 'https://buy.stripe.com/test_e2e',
      });
      expect(ctx.stripe.links[0]).toMatchObject({
        metadata: { orderId: String(orderId) },
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: 1999,
              product_data: { name: 'Fixture Tee (M, black)' },
            },
            quantity: 2,
          },
        ],
      });
      const row = await orderRow(orderId);
      expect(row.status).toBe('pending');
      expect(row.totalCents).toBe(3998);
      expect(row.items).toHaveLength(1);
      expect(await stockOf(fixture.variantId)).toBe(7);
    });

    it('pays a link order from checkout.session.completed, as payment_link', async () => {
      const res = await createLink(token, fixture.variantId, 2).expect(201);
      const orderId = res.body.orderId as number;

      await deliver(event('checkout.session.completed', orderId)).expect(200);

      const row = await orderRow(orderId);
      expect(row.status).toBe('paid');
      expect(row.paymentMethod).toBe('payment_link');
      expect(await stockOf(fixture.variantId)).toBe(5);
    });

    it('refuses a link for a withdrawn product with 404, and above stock with 409', async () => {
      const withdrawn = await seedProductWithVariant(ctx.prisma, {
        name: 'Withdrawn Tee',
        isActive: false,
      });

      await createLink(token, withdrawn.variantId, 1).expect(404);
      const res = await createLink(token, fixture.variantId, 8).expect(409);

      expect(res.body.type).toBe(
        'https://tshirt.store/problems/insufficient-stock',
      );
      expect(await ctx.prisma.order.count()).toBe(0);
      expect(ctx.stripe.links).toHaveLength(0);
    });

    it('answers 401 to an anonymous caller on both payment operations', async () => {
      await http().post('/v1/payment-links').send({}).expect(401);
      await http().post('/v1/orders/1/payments').expect(401);
    });
  });
});
