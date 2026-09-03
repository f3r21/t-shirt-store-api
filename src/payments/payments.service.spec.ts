import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import type Stripe from 'stripe';
import { PaymentsService } from './payments.service';
import { StripeGateway } from './stripe.gateway';
import { LowStockProducer } from '../stock-notifications/low-stock.producer';
import type { PrismaMock } from '../prisma/prisma.service.mock';
import {
  createPrismaMock,
  prismaMockProvider,
} from '../prisma/prisma.service.mock';
import { AS_CLIENT, AS_MANAGER, aVariant } from '../products/products.fixtures';
import { AbilityFactory } from '../authz/ability.factory';
import { nthArg } from '../common/mock-args';
import { Prisma } from '../generated/prisma/client';
import type { ProblemException } from '../common/problem/problem.exception';
import { ProblemType } from '../common/problem/problem-type';

/** Run a call that is expected to throw, and hand the error back typed. */
const caught = (run: () => Promise<unknown>) =>
  run()
    .then(() => null)
    .catch((e: unknown) => e as ProblemException);

const abilities = new AbilityFactory();
const CLIENT_ABILITY = abilities.for(AS_CLIENT);
const MANAGER_ABILITY = abilities.for(AS_MANAGER);

/**
 * A Stripe event carrying an order id, or none, in its object's metadata. A
 * session completes paid unless a case says otherwise.
 */
const anEvent = (
  type: string,
  metadata: Record<string, string> | null = { orderId: '501' },
  id = 'evt_1',
  object: Record<string, unknown> = {},
): Stripe.Event =>
  ({
    id,
    object: 'event',
    type,
    data: {
      object: {
        metadata,
        ...(type === 'checkout.session.completed'
          ? { payment_status: 'paid' }
          : {}),
        ...object,
      },
    },
  }) as unknown as Stripe.Event;

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.10.0',
  });

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: PrismaMock;
  let gateway: {
    createPaymentLink: jest.Mock;
    createPaymentIntent: jest.Mock;
    parseEvent: jest.Mock;
  };
  let notify: jest.Mock;
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;

  beforeEach(async () => {
    prisma = createPrismaMock();
    gateway = {
      createPaymentLink: jest.fn(),
      createPaymentIntent: jest.fn(),
      parseEvent: jest.fn(),
    };
    notify = jest.fn().mockResolvedValue(undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    const module = await Test.createTestingModule({
      providers: [
        PaymentsService,
        prismaMockProvider(prisma),
        { provide: StripeGateway, useValue: gateway },
        { provide: LowStockProducer, useValue: { notify } },
      ],
    }).compile();
    service = module.get(PaymentsService);
    // Both spies outlive a test: `spyOn` on an already spied method returns
    // the same spy, calls and all. Cleared after `compile()`, which writes a
    // "dependencies initialized" line through the same prototype.
    log.mockClear();
    warn.mockClear();
  });

  describe('createPaymentLink', () => {
    const sellable = () => ({
      ...aVariant({ stock: 7 }),
      product: { name: 'Nerdery classic tee' },
    });

    beforeEach(() => {
      prisma.productVariant.findFirst.mockResolvedValue(sellable());
      prisma.order.create.mockResolvedValue({ id: 502 });
      gateway.createPaymentLink.mockResolvedValue({
        url: 'https://buy.stripe.com/test_x',
      });
    });

    it('answers 404 for a variant not on sale, and creates nothing', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.createPaymentLink(AS_CLIENT, { variantId: 21, quantity: 1 }),
      ).rejects.toMatchObject({ status: 404 });

      const call = nthArg(prisma.productVariant.findFirst) as {
        where: { product: { deletedAt: null; isActive: boolean } };
      };
      expect(call.where.product).toEqual({ deletedAt: null, isActive: true });
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('answers 409 insufficient-stock above the units on hand, before any write', async () => {
      const err = await caught(() =>
        service.createPaymentLink(AS_CLIENT, { variantId: 21, quantity: 8 }),
      );

      expect(err?.type).toBe(ProblemType.InsufficientStock);
      expect(prisma.order.create).not.toHaveBeenCalled();
      expect(gateway.createPaymentLink).not.toHaveBeenCalled();
    });

    it('writes a pending order for one line, then asks Stripe with the order id, and answers the url', async () => {
      const result = await service.createPaymentLink(AS_CLIENT, {
        variantId: 21,
        quantity: 2,
      });

      const create = nthArg(prisma.order.create) as {
        data: Record<string, unknown> & {
          items: { create: Record<string, unknown> };
          statusHistory: { create: { status: string } };
        };
      };
      expect(create.data).toMatchObject({
        userId: 128,
        status: 'pending',
        subtotalCents: 3998,
        totalCents: 3998,
      });
      expect(create.data.items.create).toEqual({
        variantId: 21,
        productId: 7,
        productName: 'Nerdery classic tee',
        size: 'M',
        color: 'black',
        unitPriceCents: 1999,
        quantity: 2,
      });
      expect(create.data.statusHistory.create).toEqual({ status: 'pending' });
      expect(nthArg(gateway.createPaymentLink)).toEqual({
        orderId: 502,
        name: 'Nerdery classic tee (M, black)',
        unitAmount: 1999,
        quantity: 2,
      });
      expect(result).toEqual({
        orderId: 502,
        url: 'https://buy.stripe.com/test_x',
      });
      // Stock is checked and never written here.
      expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
    });

    it('names the line by the product alone when the variant has no options', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({
        ...sellable(),
        size: '',
        color: '',
      });

      await service.createPaymentLink(AS_CLIENT, {
        variantId: 21,
        quantity: 1,
      });

      expect((nthArg(gateway.createPaymentLink) as { name: string }).name).toBe(
        'Nerdery classic tee',
      );
    });

    it('deletes the order and rethrows when Stripe fails', async () => {
      gateway.createPaymentLink.mockRejectedValue(new Error('stripe down'));

      await expect(
        service.createPaymentLink(AS_CLIENT, { variantId: 21, quantity: 1 }),
      ).rejects.toThrow('stripe down');

      expect(nthArg(prisma.order.delete)).toEqual({ where: { id: 502 } });
    });
  });

  describe('createPaymentIntent', () => {
    const pendingOrder = () => ({
      id: 501,
      userId: 128,
      status: 'pending',
      totalCents: 4498,
      items: [
        { variantId: 21, quantity: 2 },
        { variantId: 22, quantity: 1 },
      ],
    });

    beforeEach(() => {
      prisma.order.findFirst.mockResolvedValue(pendingOrder());
      prisma.productVariant.findMany.mockResolvedValue([
        { id: 21, stock: 7 },
        { id: 22, stock: 1 },
      ]);
      gateway.createPaymentIntent.mockResolvedValue({
        clientSecret: 'pi_1_secret_x',
      });
    });

    it('answers 404 under the ownership rule', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.createPaymentIntent(AS_CLIENT, CLIENT_ABILITY, 501),
      ).rejects.toMatchObject({ status: 404 });

      const call = nthArg(prisma.order.findFirst) as { where: unknown };
      expect(call.where).toEqual({ id: 501, AND: [{ OR: [{ userId: 128 }] }] });
      expect(gateway.createPaymentIntent).not.toHaveBeenCalled();
    });

    it('answers 409 for an order that is not pending', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...pendingOrder(),
        status: 'paid',
      });

      const err = await caught(() =>
        service.createPaymentIntent(AS_CLIENT, CLIENT_ABILITY, 501),
      );

      expect(err?.getStatus()).toBe(409);
      expect(err?.getResponse()).toMatchObject({
        detail: 'An order in status paid cannot be paid.',
      });
      expect(gateway.createPaymentIntent).not.toHaveBeenCalled();
    });

    it('answers 409 insufficient-stock when a line is above the units on hand, before Stripe is asked', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        { id: 21, stock: 7 },
        { id: 22, stock: 0 },
      ]);

      const err = await caught(() =>
        service.createPaymentIntent(AS_CLIENT, CLIENT_ABILITY, 501),
      );

      expect(err?.type).toBe(ProblemType.InsufficientStock);
      expect(err?.detail).toBe(
        'This variant has 0 units on hand and the request asks for 1.',
      );
      expect(gateway.createPaymentIntent).not.toHaveBeenCalled();
    });

    it("asks Stripe for the order's total and answers the client secret", async () => {
      const result = await service.createPaymentIntent(
        AS_CLIENT,
        CLIENT_ABILITY,
        501,
      );

      expect(nthArg(gateway.createPaymentIntent)).toEqual({
        orderId: 501,
        amount: 4498,
      });
      expect(result).toEqual({
        orderId: 501,
        clientSecret: 'pi_1_secret_x',
        amount: 4498,
      });
    });

    it('lets a manager pay any order', async () => {
      await service.createPaymentIntent(AS_MANAGER, MANAGER_ABILITY, 501);

      const call = nthArg(prisma.order.findFirst) as { where: unknown };
      expect(call.where).toEqual({ id: 501, AND: [{}] });
    });
  });

  describe('applyEvent', () => {
    beforeEach(() => {
      prisma.orderItem.findMany.mockResolvedValue([
        { variantId: 21, quantity: 2 },
      ]);
      prisma.productVariant.findUniqueOrThrow.mockResolvedValue({ stock: 5 });
    });

    it('ignores an event kind it does not handle, without a row', async () => {
      await service.applyEvent(anEvent('charge.succeeded'));

      expect(prisma.stripeEvent.findUnique).not.toHaveBeenCalled();
      expect(prisma.stripeEvent.create).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'payment.event-ignored' }),
      );
    });

    it('does nothing for an event it has already applied', async () => {
      prisma.stripeEvent.findUnique.mockResolvedValue({ id: 'evt_1' });

      await service.applyEvent(anEvent('payment_intent.succeeded'));

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'payment.duplicate' }),
      );
      expect(notify).not.toHaveBeenCalled();
    });

    it('treats a losing race on the event id as the same replay', async () => {
      prisma.stripeEvent.create.mockRejectedValue(uniqueViolation());

      await expect(
        service.applyEvent(anEvent('payment_intent.succeeded')),
      ).resolves.toBeUndefined();

      expect(prisma.order.updateMany).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'payment.duplicate' }),
      );
    });

    it('records an event that names no order, and warns', async () => {
      await service.applyEvent(anEvent('payment_intent.succeeded', {}));

      expect(nthArg(prisma.stripeEvent.create)).toEqual({
        data: { id: 'evt_1', type: 'payment_intent.succeeded' },
      });
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'payment.orphan', orderId: null }),
      );
      expect(notify).not.toHaveBeenCalled();
    });

    it('pays a cart order from payment_intent.succeeded: event first, conditional move, history, stock down', async () => {
      await service.applyEvent(anEvent('payment_intent.succeeded'));

      expect(nthArg(prisma.stripeEvent.create)).toEqual({
        data: { id: 'evt_1', type: 'payment_intent.succeeded' },
      });
      expect(nthArg(prisma.order.updateMany)).toEqual({
        where: { id: 501, status: 'pending' },
        data: { status: 'paid', paymentMethod: 'payment_intent' },
      });
      expect(nthArg(prisma.orderStatusChange.create)).toEqual({
        data: { orderId: 501, status: 'paid' },
      });
      expect(nthArg(prisma.productVariant.updateMany)).toEqual({
        where: { id: 21, stock: { gte: 2 } },
        data: { stock: { decrement: 2 } },
      });
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'payment.applied',
          orderId: 501,
          method: 'payment_intent',
          stocks: [{ variantId: 21, before: 7, after: 5 }],
        }),
      );
      expect(warn).not.toHaveBeenCalled();
      // The producer hears after the transaction, with the pair it decides on.
      expect(notify).toHaveBeenCalledWith([
        { variantId: 21, before: 7, after: 5 },
      ]);
      expect(notify.mock.invocationCallOrder[0]).toBeGreaterThan(
        prisma.$transaction.mock.invocationCallOrder[0],
      );
    });

    it('pays a link order from checkout.session.completed as payment_link', async () => {
      await service.applyEvent(anEvent('checkout.session.completed'));

      expect(
        (nthArg(prisma.order.updateMany) as { data: { paymentMethod: string } })
          .data.paymentMethod,
      ).toBe('payment_link');
    });

    it('leaves an order that is no longer pending alone, keeps the event, and warns', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      prisma.order.findUnique.mockResolvedValue({ status: 'cancelled' });

      await service.applyEvent(anEvent('payment_intent.succeeded'));

      expect(prisma.stripeEvent.create).toHaveBeenCalledTimes(1);
      expect(prisma.orderStatusChange.create).not.toHaveBeenCalled();
      expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'payment.not-applied',
          orderId: 501,
          status: 'cancelled',
        }),
      );
      expect(notify).not.toHaveBeenCalled();
    });

    it('keeps a session that completed unpaid off the order, keeps the event, and warns', async () => {
      await service.applyEvent(
        anEvent('checkout.session.completed', { orderId: '501' }, 'evt_1', {
          payment_status: 'unpaid',
        }),
      );

      expect(prisma.stripeEvent.create).toHaveBeenCalledTimes(1);
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
      expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'payment.unpaid-session',
          orderId: 501,
        }),
      );
      expect(notify).not.toHaveBeenCalled();
    });

    it('treats an unknown order id as an orphan', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      prisma.order.findUnique.mockResolvedValue(null);

      await service.applyEvent(anEvent('payment_intent.succeeded'));

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'payment.orphan', orderId: 501 }),
      );
    });

    it('floors the stock at zero when the units are gone, and warns with the shortfall', async () => {
      prisma.productVariant.updateMany.mockResolvedValue({ count: 0 });
      prisma.productVariant.findUniqueOrThrow.mockResolvedValue({ stock: 1 });

      await service.applyEvent(anEvent('payment_intent.succeeded'));

      expect(nthArg(prisma.productVariant.update)).toEqual({
        where: { id: 21 },
        data: { stock: 0 },
      });
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'stock.oversold',
          variantId: 21,
          shortfall: 1,
        }),
      );
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'payment.applied',
          stocks: [{ variantId: 21, before: 1, after: 0 }],
        }),
      );
      expect(notify).toHaveBeenCalledWith([
        { variantId: 21, before: 1, after: 0 },
      ]);
    });

    it('reads a metadata order id that is not a positive integer as none', async () => {
      await service.applyEvent(
        anEvent('payment_intent.succeeded', { orderId: '5x' }),
      );

      expect(prisma.order.updateMany).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'payment.orphan' }),
      );
    });
  });

  describe('receiveEvent', () => {
    it('parses through the gateway and applies the result', async () => {
      gateway.parseEvent.mockReturnValue(anEvent('charge.succeeded'));

      await service.receiveEvent(Buffer.from('{}'), 'sig');

      expect(gateway.parseEvent).toHaveBeenCalledWith(Buffer.from('{}'), 'sig');
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'payment.event-ignored' }),
      );
    });
  });
});
