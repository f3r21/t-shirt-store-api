import { Test } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import type { PrismaMock } from '../prisma/prisma.service.mock';
import {
  createPrismaMock,
  prismaMockProvider,
} from '../prisma/prisma.service.mock';
import { AS_CLIENT, AS_MANAGER } from '../products/products.fixtures';
import { AbilityFactory } from '../authz/ability.factory';
import { aCartLine } from '../cart/cart.fixtures';
import {
  anOrder,
  anOrderWithDetail,
  anOrderWithSummary,
} from './orders.fixtures';
import { nthArg } from '../common/mock-args';
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

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = createPrismaMock();
    const module = await Test.createTestingModule({
      providers: [OrdersService, prismaMockProvider(prisma)],
    }).compile();
    service = module.get(OrdersService);
  });

  describe('createOrder', () => {
    const twoLines = () => [
      aCartLine({ row: { quantity: 2 }, variant: { id: 21, stock: 7 } }),
      aCartLine({
        row: { quantity: 1 },
        variant: { id: 22, priceCents: 500, stock: 1 },
      }),
    ];

    beforeEach(() => {
      prisma.cartItem.findMany.mockResolvedValue(twoLines());
      prisma.cartItem.deleteMany
        .mockResolvedValueOnce({ count: 2 })
        .mockResolvedValueOnce({ count: 0 });
      prisma.order.create.mockResolvedValue(anOrderWithDetail());
    });

    it('reads only this user, and only lines whose product is on sale', async () => {
      await service.createOrder(AS_CLIENT);

      const call = nthArg(prisma.cartItem.findMany) as {
        where: {
          userId: number;
          variant: { product: { deletedAt: null; isActive: boolean } };
        };
      };
      expect(call.where.userId).toBe(128);
      expect(call.where.variant.product).toEqual({
        deletedAt: null,
        isActive: true,
      });
    });

    it('answers 409 for an empty cart, and writes nothing', async () => {
      prisma.cartItem.findMany.mockResolvedValue([]);

      const err = await caught(() => service.createOrder(AS_CLIENT));

      expect(err?.getStatus()).toBe(409);
      expect(err?.getResponse()).toMatchObject({
        detail: 'The cart is empty.',
      });
      expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('answers 409 insufficient-stock for a line above the units on hand, before any write', async () => {
      prisma.cartItem.findMany.mockResolvedValue([
        aCartLine({ row: { quantity: 8 }, variant: { stock: 7 } }),
      ]);

      const err = await caught(() => service.createOrder(AS_CLIENT));

      expect(err?.type).toBe(ProblemType.InsufficientStock);
      expect(err?.detail).toBe(
        'This variant has 7 units on hand and the request asks for 8.',
      );
      expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('deletes exactly the lines it read, then whatever the read did not show', async () => {
      await service.createOrder(AS_CLIENT);

      const first = nthArg(prisma.cartItem.deleteMany, 0, 0) as {
        where: { userId: number; variantId: { in: number[] } };
      };
      const second = nthArg(prisma.cartItem.deleteMany, 0, 1) as {
        where: Record<string, unknown>;
      };
      expect(first.where).toEqual({ userId: 128, variantId: { in: [21, 22] } });
      expect(second.where).toEqual({ userId: 128 });
    });

    it('answers 409 and places no order when the delete removed fewer lines than it read', async () => {
      // The second of two checkouts racing on one cart: it read two lines,
      // blocked on the first checkout's delete, then deleted nothing.
      prisma.cartItem.deleteMany.mockReset();
      prisma.cartItem.deleteMany.mockResolvedValue({ count: 0 });

      const err = await caught(() => service.createOrder(AS_CLIENT));

      expect(err?.getStatus()).toBe(409);
      expect(err?.getResponse()).toMatchObject({
        detail: 'The cart changed while the order was created. Read it again.',
      });
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('writes the order pending, with the snapshots, the totals and the first history row', async () => {
      await service.createOrder(AS_CLIENT);

      const call = nthArg(prisma.order.create) as {
        data: {
          userId: number;
          status: string;
          subtotalCents: number;
          totalCents: number;
          items: { create: Record<string, unknown>[] };
          statusHistory: { create: { status: string } };
        };
      };
      expect(call.data.userId).toBe(128);
      expect(call.data.status).toBe('pending');
      expect(call.data.subtotalCents).toBe(4498);
      expect(call.data.totalCents).toBe(4498);
      expect(call.data.items.create).toEqual([
        {
          variantId: 21,
          productId: 7,
          productName: 'Nerdery classic tee',
          size: 'M',
          color: 'black',
          unitPriceCents: 1999,
          quantity: 2,
        },
        {
          variantId: 22,
          productId: 7,
          productName: 'Nerdery classic tee',
          size: 'M',
          color: 'black',
          unitPriceCents: 500,
          quantity: 1,
        },
      ]);
      expect(call.data.statusHistory.create).toEqual({ status: 'pending' });
    });

    it('never writes the stock: an unpaid order reserves nothing', async () => {
      await service.createOrder(AS_CLIENT);

      expect(prisma.productVariant.update).not.toHaveBeenCalled();
    });

    it('answers the order mapped for the caller', async () => {
      const order = await service.createOrder(AS_CLIENT);

      expect(order.id).toBe(501);
      expect(order.status).toBe('pending');
      expect(order).not.toHaveProperty('customer');
    });
  });

  describe('getOrder', () => {
    it("fixes the user id in the where for a client, so another client's order is the same 404", async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.getOrder(AS_CLIENT, CLIENT_ABILITY, 501),
      ).rejects.toMatchObject({
        status: 404,
      });

      const call = nthArg(prisma.order.findFirst) as {
        where: { id: number; userId?: number };
      };
      expect(call.where).toEqual({ id: 501, AND: [{ OR: [{ userId: 128 }] }] });
    });

    it('lets a manager read any order, with the customer', async () => {
      prisma.order.findFirst.mockResolvedValue(anOrderWithDetail());

      const order = await service.getOrder(AS_MANAGER, MANAGER_ABILITY, 501);

      const call = nthArg(prisma.order.findFirst) as {
        where: Record<string, unknown>;
      };
      expect(call.where).toEqual({ id: 501, AND: [{}] });
      expect(order.customer?.email).toBe('ana@example.com');
    });
  });

  describe('listMyOrders and listAllOrders', () => {
    const page = { limit: 20, offset: 0 };

    beforeEach(() => {
      prisma.order.findMany.mockResolvedValue([anOrderWithSummary()]);
      prisma.order.count.mockResolvedValue(1);
    });

    const whereOf = () =>
      (nthArg(prisma.order.findMany) as { where: Record<string, unknown> })
        .where;

    it('scopes the client history to the caller', async () => {
      await service.listMyOrders(AS_CLIENT, page);

      expect(whereOf()).toEqual({ userId: 128 });
    });

    it('lets a manager list every order, or one client with userId', async () => {
      await service.listAllOrders(AS_MANAGER, page);
      expect(whereOf()).toEqual({});

      await service.listAllOrders(AS_MANAGER, { ...page, userId: 7 });
      expect(
        (nthArg(prisma.order.findMany, 0, 1) as { where: unknown }).where,
      ).toEqual({ userId: 7 });
    });

    it('maps each filter into the where, with an inclusive from and an exclusive to', async () => {
      await service.listMyOrders(AS_CLIENT, {
        ...page,
        status: 'paid',
        createdFrom: '2026-08-01T00:00:00Z',
        createdTo: '2026-09-01T00:00:00Z',
        minTotal: 1000,
        maxTotal: 50000,
      });

      expect(whereOf()).toEqual({
        userId: 128,
        status: 'paid',
        createdAt: {
          gte: new Date('2026-08-01T00:00:00Z'),
          lt: new Date('2026-09-01T00:00:00Z'),
        },
        totalCents: { gte: 1000, lte: 50000 },
      });
    });

    it('applies only the filters it received', async () => {
      await service.listMyOrders(AS_CLIENT, { ...page, maxTotal: 500 });

      expect(whereOf()).toEqual({ userId: 128, totalCents: { lte: 500 } });
    });

    it('pages newest first and reports the whole count in meta', async () => {
      prisma.order.count.mockResolvedValue(42);

      const result = await service.listMyOrders(AS_CLIENT, {
        limit: 5,
        offset: 10,
      });

      const call = nthArg(prisma.order.findMany) as {
        orderBy: unknown;
        take: number;
        skip: number;
      };
      expect(call.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
      expect(call.take).toBe(5);
      expect(call.skip).toBe(10);
      expect(result.meta).toEqual({ total: 42, limit: 5, offset: 10 });
      expect(result.data[0]).not.toHaveProperty('customer');
    });

    it('counts with the same where it lists with', async () => {
      await service.listMyOrders(AS_CLIENT, { ...page, status: 'shipped' });

      expect(nthArg(prisma.order.count)).toEqual({
        where: { userId: 128, status: 'shipped' },
      });
    });
  });

  describe('setOrderStatus', () => {
    beforeEach(() => {
      prisma.order.findFirst.mockResolvedValue(anOrder({ status: 'pending' }));
      prisma.order.findUniqueOrThrow.mockResolvedValue(
        anOrderWithDetail({ status: 'cancelled' }),
      );
    });

    it('answers 404 under the ownership rule, and writes nothing', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.setOrderStatus(AS_CLIENT, CLIENT_ABILITY, 501, {
          status: 'cancelled',
        }),
      ).rejects.toMatchObject({ status: 404 });

      const call = nthArg(prisma.order.findFirst) as { where: unknown };
      expect(call.where).toEqual({ id: 501, AND: [{ OR: [{ userId: 128 }] }] });
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('answers 403 to a client sending anything but cancelled', async () => {
      await expect(
        service.setOrderStatus(AS_CLIENT, CLIENT_ABILITY, 501, {
          status: 'processing',
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('answers 409 order-not-cancellable after the order shipped', async () => {
      prisma.order.findFirst.mockResolvedValue(anOrder({ status: 'shipped' }));

      const err = await caught(() =>
        service.setOrderStatus(AS_CLIENT, CLIENT_ABILITY, 501, {
          status: 'cancelled',
        }),
      );

      expect(err?.type).toBe(ProblemType.OrderNotCancellable);
      expect(err?.getStatus()).toBe(409);
      expect(err?.message).toBe('Order cannot be cancelled');
      expect(err?.detail).toBe('This order already shipped.');
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('answers a plain 409 for a move the status does not allow', async () => {
      const err = await caught(() =>
        service.setOrderStatus(AS_MANAGER, MANAGER_ABILITY, 501, {
          status: 'processing',
        }),
      );

      expect(err?.getStatus()).toBe(409);
      expect(err?.getResponse()).toMatchObject({
        detail: 'An order in status pending cannot move to processing.',
      });
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('writes the move conditionally on the status it read, then the history row', async () => {
      const order = await service.setOrderStatus(
        AS_CLIENT,
        CLIENT_ABILITY,
        501,
        {
          status: 'cancelled',
        },
      );

      expect(nthArg(prisma.order.updateMany)).toEqual({
        where: { id: 501, status: 'pending' },
        data: { status: 'cancelled' },
      });
      expect(nthArg(prisma.orderStatusChange.create)).toEqual({
        data: { orderId: 501, status: 'cancelled' },
      });
      expect(order.status).toBe('cancelled');
    });

    it('answers 409 and writes no history when the order moved under it', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });

      const err = await caught(() =>
        service.setOrderStatus(AS_CLIENT, CLIENT_ABILITY, 501, {
          status: 'cancelled',
        }),
      );

      expect(err?.getStatus()).toBe(409);
      expect(prisma.orderStatusChange.create).not.toHaveBeenCalled();
    });

    it('lets a manager advance a paid order, reading any order', async () => {
      prisma.order.findFirst.mockResolvedValue(anOrder({ status: 'paid' }));
      prisma.order.findUniqueOrThrow.mockResolvedValue(
        anOrderWithDetail({ ...anOrder({ status: 'processing' }) }),
      );

      const order = await service.setOrderStatus(
        AS_MANAGER,
        MANAGER_ABILITY,
        501,
        {
          status: 'processing',
        },
      );

      const call = nthArg(prisma.order.findFirst) as { where: unknown };
      expect(call.where).toEqual({ id: 501, AND: [{}] });
      expect(order.status).toBe('processing');
      expect(order.customer).toBeDefined();
    });
  });
});
