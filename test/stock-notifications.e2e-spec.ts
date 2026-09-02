import request from 'supertest';
import { Queue } from 'bullmq';
import {
  CatalogFixture,
  createTestApp,
  ensureRoles,
  seedOrderLineFor,
  seedProductWithVariant,
  signInAs,
  truncateAll,
  TestApp,
} from './app-factory';
import { STOCK_QUEUE_NAME } from '../src/stock-notifications/stock-queue';

/**
 * The low-stock producer, end to end, through the real queue on the Redis
 * `setup-e2e.ts` names.
 *
 * What it covers that the unit spec cannot: the audience query against real
 * rows (a like, a paid order line, a notification row), both stock writers
 * reaching the producer after their commit, and BullMQ's own answer to a job
 * id that already exists. The suite owns a second `Queue` on the same name to
 * read and to empty the jobs; the application's queue is the one under test.
 *
 * The webhook handler awaits the enqueue before it answers, so a job is
 * readable right after the response. No worker runs here: the jobs stay
 * waiting, which is what makes them countable.
 */
describe('Stock notifications, the producer (e2e)', () => {
  let ctx: TestApp;
  let inspect: Queue;
  let fixture: CatalogFixture;

  const SECRET = process.env.STRIPE_WEBHOOK_SECRET as string;

  const http = () => request(ctx.app.getHttpServer());
  const bearer = (t: string) => `Bearer ${t}`;

  const idOf = async (email: string) =>
    (await ctx.prisma.user.findUniqueOrThrow({ where: { email } })).id;

  const like = (t: string, variantId: number) =>
    http()
      .put(`/v1/variants/${variantId}/like`)
      .set('Authorization', bearer(t));

  const told = async (email: string, variantId: number) =>
    ctx.prisma.stockNotification.create({
      data: { userId: await idOf(email), variantId },
    });

  const setStock = (t: string, variantId: number, stock: number) =>
    http()
      .patch(`/v1/variants/${variantId}/stock`)
      .set('Authorization', bearer(t))
      .send({ stock });

  const stockOf = async (variantId: number) =>
    (
      await ctx.prisma.productVariant.findUniqueOrThrow({
        where: { id: variantId },
      })
    ).stock;

  const event = (orderId: number, id = 'evt_1') =>
    JSON.stringify({
      id,
      object: 'event',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'obj_1', metadata: { orderId: String(orderId) } } },
    });

  const deliver = (payload: string) =>
    http()
      .post('/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set(
        'Stripe-Signature',
        ctx.stripe.webhooks.generateTestHeaderString({
          payload,
          secret: SECRET,
        }),
      )
      .send(payload);

  /** Put `quantity` of the fixture in the cart, order it, pay it. */
  const buy = async (t: string, quantity: number, eventId = 'evt_1') => {
    await http()
      .post('/v1/users/me/cart/items')
      .set('Authorization', bearer(t))
      .send({ variantId: fixture.variantId, quantity })
      .expect(200);
    const res = await http()
      .post('/v1/orders')
      .set('Authorization', bearer(t))
      .expect(201);
    const orderId = res.body.id as number;
    await deliver(event(orderId, eventId)).expect(200);
    return orderId;
  };

  /** Every job in the queue, whatever its state, oldest id first. */
  const jobs = async () => {
    const rows = await inspect.getJobs([
      'waiting',
      'delayed',
      'prioritized',
      'active',
      'completed',
      'failed',
    ]);
    return rows
      .map((job) => ({ id: job.id, name: job.name, data: job.data as unknown }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await ensureRoles(ctx.prisma);
    inspect = new Queue(STOCK_QUEUE_NAME, {
      connection: { url: process.env.REDIS_URL as string },
    });
  });

  afterAll(async () => {
    await inspect.close();
    await ctx.app.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    ctx.stripe.clear();
    await inspect.obliterate({ force: true });
  });

  it('enqueues one job, for the liker who has not bought and has not been told, when a payment takes the stock from 4 to 3', async () => {
    fixture = await seedProductWithVariant(ctx.prisma, { stock: 4 });
    const other = await seedProductWithVariant(ctx.prisma, {
      name: 'Other Tee',
    });
    const ana = await signInAs(ctx, 'ana@example.com');
    const bob = await signInAs(ctx, 'bob@example.com');
    const carol = await signInAs(ctx, 'carol@example.com');
    const dave = await signInAs(ctx, 'dave@example.com');
    const eve = await signInAs(ctx, 'eve@example.com');
    await like(ana, fixture.variantId).expect(204);
    await like(bob, fixture.variantId).expect(204);
    await seedOrderLineFor(ctx.prisma, fixture, 'bob@example.com');
    await like(carol, fixture.variantId).expect(204);
    await told('carol@example.com', fixture.variantId);
    await like(dave, other.variantId).expect(204);
    await like(eve, fixture.variantId).expect(204);

    await buy(eve, 1);

    expect(await stockOf(fixture.variantId)).toBe(3);
    const anaId = await idOf('ana@example.com');
    expect(await jobs()).toEqual([
      {
        id: `low-stock:${fixture.variantId}:${anaId}`,
        name: 'low-stock',
        data: { variantId: fixture.variantId, userId: anaId },
      },
    ]);
  });

  it('enqueues when one purchase takes the stock from 5 to 2, past the threshold', async () => {
    fixture = await seedProductWithVariant(ctx.prisma, { stock: 5 });
    const ana = await signInAs(ctx, 'ana@example.com');
    const eve = await signInAs(ctx, 'eve@example.com');
    await like(ana, fixture.variantId).expect(204);

    await buy(eve, 3);

    expect(await stockOf(fixture.variantId)).toBe(2);
    expect(await jobs()).toHaveLength(1);
  });

  it('enqueues nothing when the stock goes from 3 to 2, already below the threshold', async () => {
    fixture = await seedProductWithVariant(ctx.prisma, { stock: 3 });
    const ana = await signInAs(ctx, 'ana@example.com');
    const eve = await signInAs(ctx, 'eve@example.com');
    await like(ana, fixture.variantId).expect(204);

    await buy(eve, 1);

    expect(await stockOf(fixture.variantId)).toBe(2);
    expect(await jobs()).toEqual([]);
  });

  it("enqueues on a manager's stock count from 10 to 3, and not on one from 3 to 10", async () => {
    fixture = await seedProductWithVariant(ctx.prisma, { stock: 10 });
    const ana = await signInAs(ctx, 'ana@example.com');
    const manager = await signInAs(ctx, 'boss@example.com', 'manager');
    await like(ana, fixture.variantId).expect(204);

    await setStock(manager, fixture.variantId, 3).expect(200);
    expect(await jobs()).toHaveLength(1);

    await inspect.obliterate({ force: true });
    await setStock(manager, fixture.variantId, 10).expect(200);
    expect(await jobs()).toEqual([]);
  });

  it('enqueues nothing more for a replayed webhook', async () => {
    fixture = await seedProductWithVariant(ctx.prisma, { stock: 4 });
    const ana = await signInAs(ctx, 'ana@example.com');
    const eve = await signInAs(ctx, 'eve@example.com');
    await like(ana, fixture.variantId).expect(204);
    const orderId = await buy(eve, 1);
    expect(await jobs()).toHaveLength(1);

    // Emptied first, so a second job would be visible and not hidden by the
    // id that already exists.
    await inspect.obliterate({ force: true });
    await deliver(event(orderId)).expect(200);

    expect(await jobs()).toEqual([]);
    expect(await stockOf(fixture.variantId)).toBe(3);
  });

  it('leaves one job when the stock crosses twice before any worker runs', async () => {
    fixture = await seedProductWithVariant(ctx.prisma, { stock: 10 });
    const ana = await signInAs(ctx, 'ana@example.com');
    const manager = await signInAs(ctx, 'boss@example.com', 'manager');
    await like(ana, fixture.variantId).expect(204);

    await setStock(manager, fixture.variantId, 3).expect(200);
    await setStock(manager, fixture.variantId, 10).expect(200);
    await setStock(manager, fixture.variantId, 3).expect(200);

    const anaId = await idOf('ana@example.com');
    expect((await jobs()).map((job) => job.id)).toEqual([
      `low-stock:${fixture.variantId}:${anaId}`,
    ]);
  });
});
