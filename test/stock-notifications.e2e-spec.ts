import request from 'supertest';
import { Queue } from 'bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { MAILER } from '../src/mail/mailer';
import { WorkerModule } from '../src/stock-notifications/worker.module';
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

  /**
   * The consumer, booted beside the API in this process from `WorkerModule`
   * with the same mail spy, so a job enqueued by the API above is processed
   * here and its mail is readable. The spy is the only double: the queue, the
   * worker, the database and the row are real.
   *
   * Each case waits on the outcome with a bounded poll rather than on the
   * worker's events, so the assertion is on the effect and not on BullMQ's
   * event order.
   */
  describe('the worker', () => {
    const IMAGE = 'https://cdn.example/products/front.jpg';
    let worker: TestingModule;

    const until = async (
      condition: () => boolean | Promise<boolean>,
      ms = 6000,
    ): Promise<boolean> => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (await condition()) {
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return condition();
    };

    const mails = () => ctx.mail.sent.filter((m) => m.kind === 'low-stock');
    const rows = () => ctx.prisma.stockNotification.count();
    const counts = () =>
      inspect.getJobCounts(
        'waiting',
        'delayed',
        'active',
        'completed',
        'failed',
      );
    const settled = () =>
      until(async () => {
        const c = await counts();
        return c.waiting === 0 && c.delayed === 0 && c.active === 0;
      });

    beforeAll(async () => {
      worker = await Test.createTestingModule({ imports: [WorkerModule] })
        .overrideProvider(MAILER)
        .useValue(ctx.mail)
        .compile();
      await worker.init();
    });

    afterAll(async () => {
      await worker.close();
    });

    beforeEach(() => {
      ctx.mail.clear();
    });

    it('mails the one liker with the product, the count and the image, writes the row once, and leaves no failed job', async () => {
      fixture = await seedProductWithVariant(ctx.prisma, {
        stock: 4,
        images: [{ url: IMAGE, isPrimary: true }],
      });
      const ana = await signInAs(ctx, 'ana@example.com');
      const eve = await signInAs(ctx, 'eve@example.com');
      await like(ana, fixture.variantId).expect(204);

      await buy(eve, 1);

      expect(await until(() => mails().length === 1)).toBe(true);
      expect(mails()[0]).toEqual({
        kind: 'low-stock',
        to: 'ana@example.com',
        mail: {
          productId: fixture.productId,
          productName: 'Fixture Tee',
          size: 'M',
          color: 'black',
          stock: 3,
          imageUrl: IMAGE,
        },
      });
      expect(await rows()).toBe(1);
      expect(await settled()).toBe(true);
      // Completed jobs are removed by the queue's defaults; a failed one stays.
      expect(await counts()).toMatchObject({ completed: 0, failed: 0 });
    });

    it('retries a send that failed once, and the mail arrives on the second attempt', async () => {
      fixture = await seedProductWithVariant(ctx.prisma, { stock: 4 });
      const ana = await signInAs(ctx, 'ana@example.com');
      const eve = await signInAs(ctx, 'eve@example.com');
      await like(ana, fixture.variantId).expect(204);
      ctx.mail.failNextSends(1);

      await buy(eve, 1);

      expect(await until(() => mails().length === 1)).toBe(true);
      expect(mails()[0]).toMatchObject({ to: 'ana@example.com' });
      expect(await rows()).toBe(1);
      expect(await settled()).toBe(true);
      expect(await counts()).toMatchObject({ failed: 0 });
    }, 10000);

    it('mails nobody for a pair already told, and keeps the row', async () => {
      fixture = await seedProductWithVariant(ctx.prisma, { stock: 4 });
      await signInAs(ctx, 'ana@example.com');
      const anaId = await idOf('ana@example.com');
      await told('ana@example.com', fixture.variantId);

      // Straight into the queue: the producer would not enqueue this pair,
      // and the worker has to hold its own when a row appears in between.
      await inspect.add(
        'low-stock',
        { variantId: fixture.variantId, userId: anaId },
        { jobId: `low-stock:${fixture.variantId}:${anaId}` },
      );

      expect(await until(async () => (await counts()).completed === 1)).toBe(
        true,
      );
      expect(mails()).toEqual([]);
      expect(await rows()).toBe(1);
    });

    it('leaves a job in the failed set, no row and no mail, when the send fails on every attempt', async () => {
      fixture = await seedProductWithVariant(ctx.prisma, { stock: 4 });
      const ana = await signInAs(ctx, 'ana@example.com');
      const eve = await signInAs(ctx, 'eve@example.com');
      await like(ana, fixture.variantId).expect(204);
      ctx.mail.failNextSends(3);

      await buy(eve, 1);

      expect(
        await until(async () => (await counts()).failed === 1, 12000),
      ).toBe(true);
      expect(mails()).toEqual([]);
      expect(await rows()).toBe(0);
    }, 15000);
  });
});
