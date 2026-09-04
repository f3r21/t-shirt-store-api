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
 * A promo code applied at checkout, the client's half of Optional Feature 13.
 *
 * Its own suite rather than a block inside `checkout.e2e-spec.ts`, because it
 * needs a second client and a manager on every run and that file's fixture is
 * one client. What it proves that a service spec cannot: the case-insensitive
 * match, which is the `citext` column and not a comparison in TypeScript, and
 * the race on the last use, which is Postgres re-reading the `where` after the
 * winner commits. ADR 34, ADR 37.
 */
describe('Promo codes at checkout (e2e)', () => {
  let ctx: TestApp;
  let token: string;
  let manager: string;
  let fixture: CatalogFixture;

  const http = () => request(ctx.app.getHttpServer());
  const bearer = (t: string) => `Bearer ${t}`;

  const addToCart = (t: string, variantId: number, quantity: number) =>
    http()
      .post('/v1/users/me/cart/items')
      .set('Authorization', bearer(t))
      .send({ variantId, quantity });

  /** No body at all when the caller names no code, which is what a client sends. */
  const createOrder = (t: string, body?: Record<string, unknown>) => {
    const call = http().post('/v1/orders').set('Authorization', bearer(t));
    return body === undefined ? call : call.send(body);
  };

  const createIntent = (t: string, id: number) =>
    http().post(`/v1/orders/${id}/payments`).set('Authorization', bearer(t));

  const getOrder = (t: string, id: number) =>
    http().get(`/v1/orders/${id}`).set('Authorization', bearer(t));

  const myOrders = (t: string) =>
    http().get('/v1/users/me/orders').set('Authorization', bearer(t));

  /** Codes are made through the manager's own operation, not written raw. */
  const createCode = (body: Record<string, unknown>) =>
    http()
      .post('/v1/promo-codes')
      .set('Authorization', bearer(manager))
      .send(body);

  const disableCode = (id: number) =>
    http()
      .patch(`/v1/promo-codes/${id}`)
      .set('Authorization', bearer(manager))
      .send({ isActive: false });

  /** A 10 percent code, the one most cases use. Returns its id. */
  const save10 = async (
    extra: Record<string, unknown> = {},
  ): Promise<number> => {
    const res = await createCode({
      code: 'SAVE10',
      discountType: 'percentage',
      discountValue: 10,
      ...extra,
    }).expect(201);
    return res.body.id as number;
  };

  const orderRow = (id: number) =>
    ctx.prisma.order.findUniqueOrThrow({ where: { id } });

  const codeRow = (id: number) =>
    ctx.prisma.promoCode.findUniqueOrThrow({ where: { id } });

  const cartLines = () => ctx.prisma.cartItem.count();

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
    // 1999 a unit, two of them, so every subtotal below is 3998.
    fixture = await seedProductWithVariant(ctx.prisma, { stock: 7 });
    token = await signInAs(ctx, 'ana@example.com');
    manager = await signInAs(ctx, 'manager@example.com', 'manager');
    await addToCart(token, fixture.variantId, 2).expect(200);
  });

  describe('applying a code', () => {
    it('takes the percentage off the subtotal, counts the use, and empties the cart', async () => {
      const id = await save10();

      const res = await createOrder(token, { promoCode: 'SAVE10' }).expect(201);

      // 10 percent of 3998 is 399.8, and the discount is a whole minor unit.
      expect(res.body).toMatchObject({
        subtotal: 3998,
        discount: 399,
        total: 3599,
        promoCode: 'SAVE10',
      });
      const row = await orderRow(res.body.id as number);
      expect(row.subtotalCents).toBe(3998);
      expect(row.discountCents).toBe(399);
      expect(row.totalCents).toBe(3599);
      expect(row.promoCodeId).toBe(id);
      expect(row.promoCode).toBe('SAVE10');
      expect((await codeRow(id)).usedCount).toBe(1);
      expect(await cartLines()).toBe(0);
    });

    it('matches the code without case, and records the case the manager typed', async () => {
      await save10();

      const res = await createOrder(token, { promoCode: 'save10' }).expect(201);

      // The `citext` column decides this. With `text` the code would be
      // unknown and this request would be a 422.
      expect(res.body.promoCode).toBe('SAVE10');
    });

    it('takes a fixed amount, and never more than the subtotal', async () => {
      await createCode({
        code: 'FREEBIE',
        discountType: 'fixed',
        discountValue: 100000,
      }).expect(201);

      const res = await createOrder(token, { promoCode: 'FREEBIE' }).expect(
        201,
      );

      expect(res.body).toMatchObject({
        subtotal: 3998,
        discount: 3998,
        total: 0,
      });
    });

    it('places the order at full price when the body names no code', async () => {
      const res = await createOrder(token).expect(201);

      expect(res.body).toMatchObject({
        subtotal: 3998,
        discount: 0,
        total: 3998,
      });
      expect(res.body).not.toHaveProperty('promoCode');
      expect((await orderRow(res.body.id as number)).promoCodeId).toBeNull();
    });

    it('answers 400 naming the field for a code that is not a value a code could be', async () => {
      const res = await createOrder(token, { promoCode: '' }).expect(400);

      expect(res.body.errors).toEqual([
        { field: 'promoCode', message: expect.any(String) as string },
      ]);
      expect(await ctx.prisma.order.count()).toBe(0);
    });
  });

  describe('the payment that follows', () => {
    it('charges the discounted total and not the subtotal', async () => {
      await save10();
      const order = await createOrder(token, { promoCode: 'SAVE10' }).expect(
        201,
      );

      const res = await createIntent(token, order.body.id as number).expect(
        201,
      );

      expect(res.body.amount).toBe(3599);
      expect(ctx.stripe.intents[0]).toMatchObject({
        amount: 3599,
        currency: 'usd',
      });
    });

    it('refuses an intent for an order a code took to 0, and asks Stripe nothing', async () => {
      await createCode({
        code: 'FREEBIE',
        discountType: 'fixed',
        discountValue: 100000,
      }).expect(201);
      const order = await createOrder(token, { promoCode: 'FREEBIE' }).expect(
        201,
      );

      const res = await createIntent(token, order.body.id as number).expect(
        409,
      );

      expect(res.body.detail).toBe(
        'The total of this order is below the smallest amount the payment provider accepts.',
      );
      expect(ctx.stripe.intents).toHaveLength(0);
    });
  });

  describe('the four refusals', () => {
    /** Every refusal leaves the cart and the orders exactly as they were. */
    const nothingHappened = async () => {
      expect(await ctx.prisma.order.count()).toBe(0);
      expect(await cartLines()).toBe(1);
    };

    it('answers 422 promo-code-unknown for a code no row holds', async () => {
      const res = await createOrder(token, { promoCode: 'NOSUCH' }).expect(422);

      expect(res.type).toBe('application/problem+json');
      expect(res.body).toMatchObject({
        type: 'https://tshirt.store/problems/promo-code-unknown',
        title: 'Promo code unknown',
        status: 422,
        detail: 'This promo code does not exist, or it is disabled.',
      });
      await nothingHappened();
    });

    it('answers the same promo-code-unknown for a code the manager disabled', async () => {
      const id = await save10();
      await disableCode(id).expect(200);

      const res = await createOrder(token, { promoCode: 'SAVE10' }).expect(422);

      expect(res.body.type).toBe(
        'https://tshirt.store/problems/promo-code-unknown',
      );
      expect((await codeRow(id)).usedCount).toBe(0);
      await nothingHappened();
    });

    it('answers 422 promo-code-expired for a code past its date', async () => {
      const id = await save10({ expiresAt: '2026-08-31T23:59:59.000Z' });

      const res = await createOrder(token, { promoCode: 'SAVE10' }).expect(422);

      expect(res.body).toMatchObject({
        type: 'https://tshirt.store/problems/promo-code-expired',
        title: 'Promo code expired',
        detail: 'This promo code expired on 2026-08-31T23:59:59.000Z.',
      });
      expect((await codeRow(id)).usedCount).toBe(0);
      await nothingHappened();
    });

    it('answers 422 promo-code-exhausted once the limit is reached', async () => {
      const id = await save10({ usageLimit: 1 });
      // The first order takes the one use this code allows.
      await createOrder(token, { promoCode: 'SAVE10' }).expect(201);
      await addToCart(token, fixture.variantId, 2).expect(200);

      const res = await createOrder(token, { promoCode: 'SAVE10' }).expect(422);

      expect(res.body).toMatchObject({
        type: 'https://tshirt.store/problems/promo-code-exhausted',
        title: 'Promo code exhausted',
        detail: 'This promo code reached its usage limit.',
      });
      // The refused checkout counted nothing and left its cart alone.
      expect((await codeRow(id)).usedCount).toBe(1);
      expect(await ctx.prisma.order.count()).toBe(1);
      expect(await cartLines()).toBe(1);
    });

    it('answers 422 promo-code-minimum below the minimum purchase', async () => {
      const id = await save10({ minPurchase: 5000 });

      const res = await createOrder(token, { promoCode: 'SAVE10' }).expect(422);

      expect(res.body).toMatchObject({
        type: 'https://tshirt.store/problems/promo-code-minimum',
        title: 'Order below the promo code minimum',
        detail:
          'This promo code applies to a subtotal of 5000 or more, and this order is 3998.',
      });
      expect((await codeRow(id)).usedCount).toBe(0);
      await nothingHappened();
    });

    it('accepts a subtotal equal to the minimum, which is the control', async () => {
      await save10({ minPurchase: 3998 });

      await createOrder(token, { promoCode: 'SAVE10' }).expect(201);
    });
  });

  /**
   * The guarded increment, ten times over.
   *
   * Two clients check out against a code with one use left, at the same
   * instant. The winner's `updateMany` holds the row; the loser blocks, and
   * when it runs Postgres re-reads its `where` against the committed value and
   * matches nothing. Ten trials because a race that passes once passes by
   * luck. ADR 34.
   *
   * The accounts and the product are made once. Between trials only the rows
   * this case writes are removed, which keeps a trial to a handful of requests
   * rather than three argon2 sign-ups.
   */
  it('gives the last use to one of two concurrent checkouts, ten times over', async () => {
    const bob = await signInAs(ctx, 'bob@example.com');

    for (let trial = 0; trial < 10; trial += 1) {
      // Orders first: `promo_code_id` is ON DELETE RESTRICT, so a code cannot
      // go while an order still points at it.
      await ctx.prisma.order.deleteMany({});
      await ctx.prisma.promoCode.deleteMany({});
      await ctx.prisma.cartItem.deleteMany({});
      const id = await save10({ usageLimit: 1 });
      await addToCart(token, fixture.variantId, 1).expect(200);
      await addToCart(bob, fixture.variantId, 1).expect(200);

      const [ana, other] = await Promise.all([
        createOrder(token, { promoCode: 'SAVE10' }),
        createOrder(bob, { promoCode: 'SAVE10' }),
      ]);

      expect([ana.status, other.status].sort()).toEqual([201, 422]);
      const refused = ana.status === 422 ? ana : other;
      expect(refused.body.type).toBe(
        'https://tshirt.store/problems/promo-code-exhausted',
      );
      expect((await codeRow(id)).usedCount).toBe(1);
      expect(await ctx.prisma.order.count()).toBe(1);
    }
    // Ten trials of two concurrent checkouts, each with its own sign-in and
    // cart writes, do not fit the 5 second default. The bound is the loop's
    // size and not a flaky assertion waiting longer.
  }, 60000);

  describe('the order history', () => {
    it('carries the code and the discount on the detail and in the list', async () => {
      await save10();
      const created = await createOrder(token, { promoCode: 'SAVE10' }).expect(
        201,
      );
      const id = created.body.id as number;

      const detail = await getOrder(token, id).expect(200);
      expect(detail.body).toMatchObject({
        subtotal: 3998,
        discount: 399,
        total: 3599,
        promoCode: 'SAVE10',
      });

      const page = await myOrders(token).expect(200);
      expect(page.body.data[0]).toMatchObject({
        id,
        discount: 399,
        total: 3599,
        promoCode: 'SAVE10',
      });
    });

    it('shows the code and the discount to a manager reading the order', async () => {
      await save10();
      const created = await createOrder(token, { promoCode: 'SAVE10' }).expect(
        201,
      );

      const res = await getOrder(manager, created.body.id as number).expect(
        200,
      );

      expect(res.body).toMatchObject({ discount: 399, promoCode: 'SAVE10' });
      expect(res.body.customer).toMatchObject({ email: 'ana@example.com' });
    });

    it('gives an order with no code a discount of 0 and no promoCode member', async () => {
      const created = await createOrder(token).expect(201);

      const res = await getOrder(token, created.body.id as number).expect(200);

      expect(res.body.discount).toBe(0);
      expect(res.body).not.toHaveProperty('promoCode');
    });

    it('keeps the code and the discount the order was placed with after the row changes', async () => {
      const id = await save10();
      const created = await createOrder(token, { promoCode: 'SAVE10' }).expect(
        201,
      );

      // The manager renames the code and doubles it. An order is a fixed
      // record, the way a line's `unit_price_cents` is.
      await http()
        .patch(`/v1/promo-codes/${id}`)
        .set('Authorization', bearer(manager))
        .send({ code: 'SAVE20', discountType: 'percentage', discountValue: 20 })
        .expect(200);

      const res = await getOrder(token, created.body.id as number).expect(200);

      expect(res.body).toMatchObject({
        discount: 399,
        total: 3599,
        promoCode: 'SAVE10',
      });
    });
  });
});
