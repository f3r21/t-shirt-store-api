import { Test } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import type { PrismaMock } from '../prisma/prisma.service.mock';
import {
  createPrismaMock,
  prismaMockProvider,
} from '../prisma/prisma.service.mock';
import { AS_CLIENT, AS_MANAGER } from '../products/products.fixtures';
import { AS_DELIVERY } from '../authz/authz.fixtures';
import { AbilityFactory } from '../authz/ability.factory';
import { aCartLine } from '../cart/cart.fixtures';
import { aPromoCode } from '../promo-codes/promo-codes.fixtures';
import type { PromoCode as PromoCodeRow } from '../generated/prisma/client';
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
const DELIVERY_ABILITY = abilities.for(AS_DELIVERY);

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
      await service.createOrder(AS_CLIENT, {});

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

      const err = await caught(() => service.createOrder(AS_CLIENT, {}));

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

      const err = await caught(() => service.createOrder(AS_CLIENT, {}));

      expect(err?.type).toBe(ProblemType.InsufficientStock);
      expect(err?.detail).toBe(
        'This variant has 7 units on hand and the request asks for 8.',
      );
      expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('deletes exactly the lines it read, then whatever the read did not show', async () => {
      await service.createOrder(AS_CLIENT, {});

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

      const err = await caught(() => service.createOrder(AS_CLIENT, {}));

      expect(err?.getStatus()).toBe(409);
      expect(err?.getResponse()).toMatchObject({
        detail: 'The cart changed while the order was created. Read it again.',
      });
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('writes the order pending, with the snapshots, the totals and the first history row', async () => {
      await service.createOrder(AS_CLIENT, {});

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
      await service.createOrder(AS_CLIENT, {});

      expect(prisma.productVariant.update).not.toHaveBeenCalled();
    });

    it('answers the order mapped for the caller', async () => {
      const order = await service.createOrder(AS_CLIENT, {});

      expect(order.id).toBe(501);
      expect(order.status).toBe('pending');
      expect(order).not.toHaveProperty('customer');
    });

    /**
     * Optional Feature 13, the client's half. Every case fixes the subtotal
     * with one line at a stated price, so the arithmetic under test is two
     * literals and not a sum the reader has to do. ADR 37.
     */
    describe('with a promo code', () => {
      /** One line at this price, quantity one, so the subtotal is `cents`. */
      const cartWorth = (cents: number) => {
        prisma.cartItem.findMany.mockResolvedValue([
          aCartLine({
            row: { quantity: 1 },
            variant: { id: 21, priceCents: cents, stock: 7 },
          }),
        ]);
        prisma.cartItem.deleteMany.mockReset();
        prisma.cartItem.deleteMany
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 });
      };

      const codeOnFile = (overrides: Partial<PromoCodeRow> = {}) =>
        prisma.promoCode.findUnique.mockResolvedValue(aPromoCode(overrides));

      /** What the checkout asked Prisma to write on `orders`. */
      const written = () =>
        (nthArg(prisma.order.create) as { data: Record<string, unknown> }).data;

      /** The client sends the code in another case than the manager typed. */
      const checkout = () =>
        service.createOrder(AS_CLIENT, { promoCode: 'save10' });

      beforeEach(() => {
        cartWorth(1999);
        codeOnFile();
      });

      it('looks the code up by the value the client sent', async () => {
        await checkout();

        expect(nthArg(prisma.promoCode.findUnique)).toEqual({
          where: { code: 'save10' },
        });
      });

      it('takes the percentage off the subtotal and rounds down', async () => {
        // 10 percent of 1999 is 199.9, and a discount is a whole minor unit.
        codeOnFile({ discountType: 'percentage', discountValue: 10 });

        await checkout();

        expect(written().subtotalCents).toBe(1999);
        expect(written().discountCents).toBe(199);
        expect(written().totalCents).toBe(1800);
      });

      it('takes the whole subtotal at 100 percent, and the total is 0', async () => {
        codeOnFile({ discountType: 'percentage', discountValue: 100 });

        await checkout();

        expect(written().discountCents).toBe(1999);
        expect(written().totalCents).toBe(0);
      });

      it('rounds a discount below one minor unit down to nothing', async () => {
        // Half of 1 is 0.5. Rounding up would give the store 0 for a code that
        // says half price, so the floor is the direction that cannot lose.
        cartWorth(1);
        codeOnFile({ discountType: 'percentage', discountValue: 50 });

        await checkout();

        expect(written().discountCents).toBe(0);
        expect(written().totalCents).toBe(1);
      });

      it('never takes more than the subtotal off for a fixed amount', async () => {
        codeOnFile({ discountType: 'fixed', discountValue: 5000 });

        await checkout();

        expect(written().discountCents).toBe(1999);
        expect(written().totalCents).toBe(0);
      });

      it('takes a fixed amount below the subtotal in full', async () => {
        codeOnFile({ discountType: 'fixed', discountValue: 500 });

        await checkout();

        expect(written().discountCents).toBe(500);
        expect(written().totalCents).toBe(1499);
      });

      it('snapshots the code as the manager typed it, beside the row it points at', async () => {
        codeOnFile({ id: 4, code: 'SAVE10' });

        await checkout();

        expect(written().promoCodeId).toBe(4);
        expect(written().promoCode).toBe('SAVE10');
      });

      it('reads no code and writes no discount when the body names none', async () => {
        await service.createOrder(AS_CLIENT, {});

        expect(prisma.promoCode.findUnique).not.toHaveBeenCalled();
        expect(prisma.promoCode.updateMany).not.toHaveBeenCalled();
        expect(written().discountCents).toBe(0);
        expect(written().totalCents).toBe(1999);
        expect(written()).not.toHaveProperty('promoCode');
        expect(written()).not.toHaveProperty('promoCodeId');
      });

      it('answers 422 promo-code-unknown for a code no row holds, and writes nothing', async () => {
        prisma.promoCode.findUnique.mockResolvedValue(null);

        const err = await caught(checkout);

        expect(err?.getStatus()).toBe(422);
        expect(err?.type).toBe(ProblemType.PromoCodeUnknown);
        expect(err?.detail).toBe(
          'This promo code does not exist, or it is disabled.',
        );
        expect(prisma.order.create).not.toHaveBeenCalled();
        expect(prisma.promoCode.updateMany).not.toHaveBeenCalled();
      });

      it('answers the same promo-code-unknown for a code a manager disabled', async () => {
        codeOnFile({ isActive: false });

        const err = await caught(checkout);

        expect(err?.getStatus()).toBe(422);
        expect(err?.type).toBe(ProblemType.PromoCodeUnknown);
        expect(prisma.order.create).not.toHaveBeenCalled();
      });

      it('answers 422 promo-code-expired past the expiry date, and writes nothing', async () => {
        codeOnFile({ expiresAt: new Date('2026-08-31T23:59:59.000Z') });

        const err = await caught(checkout);

        expect(err?.getStatus()).toBe(422);
        expect(err?.type).toBe(ProblemType.PromoCodeExpired);
        expect(err?.detail).toBe(
          'This promo code expired on 2026-08-31T23:59:59.000Z.',
        );
        expect(prisma.order.create).not.toHaveBeenCalled();
      });

      it('accepts a code whose expiry date has not arrived, which is the control', async () => {
        codeOnFile({ expiresAt: new Date('2099-01-01T00:00:00.000Z') });

        await checkout();

        expect(prisma.order.create).toHaveBeenCalled();
      });

      it('answers 422 promo-code-minimum below the minimum purchase, and writes nothing', async () => {
        codeOnFile({ minPurchaseCents: 2000 });

        const err = await caught(checkout);

        expect(err?.getStatus()).toBe(422);
        expect(err?.type).toBe(ProblemType.PromoCodeMinimum);
        expect(err?.detail).toBe(
          'This promo code applies to a subtotal of 2000 or more, and this order is 1999.',
        );
        expect(prisma.order.create).not.toHaveBeenCalled();
      });

      it('accepts a subtotal equal to the minimum, which is the control', async () => {
        cartWorth(2000);
        codeOnFile({ minPurchaseCents: 2000 });

        await checkout();

        expect(prisma.order.create).toHaveBeenCalled();
      });

      it('counts the use with the limit it read in the where', async () => {
        codeOnFile({ id: 4, usageLimit: 5, usedCount: 2 });

        await checkout();

        expect(prisma.promoCode.updateMany).toHaveBeenCalledWith({
          where: { id: 4, usedCount: { lt: 5 } },
          data: { usedCount: { increment: 1 } },
        });
      });

      it('increments with nothing to guard when the code has no limit', async () => {
        codeOnFile({ id: 4, usageLimit: null });

        await checkout();

        expect(prisma.promoCode.updateMany).toHaveBeenCalledWith({
          where: { id: 4 },
          data: { usedCount: { increment: 1 } },
        });
      });

      it('answers 422 promo-code-exhausted when the guarded increment moved no row', async () => {
        // The loser of two checkouts racing for the last use: it read a code
        // with room, blocked on the winner's update, then matched nothing.
        codeOnFile({ usageLimit: 1 });
        prisma.promoCode.updateMany.mockResolvedValue({ count: 0 });

        const err = await caught(checkout);

        expect(err?.getStatus()).toBe(422);
        expect(err?.type).toBe(ProblemType.PromoCodeExhausted);
        expect(err?.detail).toBe('This promo code reached its usage limit.');
        expect(prisma.order.create).not.toHaveBeenCalled();
      });
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

    // Written by hand against the service, 2026-09-03. The webhook takes the
    // units on `paid`, so a cancel of a paid or processing order gives them
    // back, one atomic increment per line, in the same transaction.
    it('gives each line its units back when a paid order is cancelled', async () => {
      prisma.order.findFirst.mockResolvedValue(anOrder({ status: 'paid' }));
      prisma.orderItem.findMany.mockResolvedValue([
        { variantId: 21, quantity: 2 },
        { variantId: 22, quantity: 1 },
      ]);

      await service.setOrderStatus(AS_CLIENT, CLIENT_ABILITY, 501, {
        status: 'cancelled',
      });

      expect(nthArg(prisma.orderItem.findMany)).toMatchObject({
        where: { orderId: 501 },
      });
      expect(nthArg(prisma.productVariant.updateMany, 0, 0)).toEqual({
        where: { id: 21 },
        data: { stock: { increment: 2 } },
      });
      expect(nthArg(prisma.productVariant.updateMany, 0, 1)).toEqual({
        where: { id: 22 },
        data: { stock: { increment: 1 } },
      });
    });

    it('touches no stock when a pending order is cancelled, because none was taken', async () => {
      await service.setOrderStatus(AS_CLIENT, CLIENT_ABILITY, 501, {
        status: 'cancelled',
      });

      expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
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

    /**
     * The delivery branch. `delivered` asks `deliver` and not `update`, so a
     * client is 403 on it and a delivery person is 403 on everything else,
     * and the write records who delivered the order in the same conditional
     * `updateMany` as the status. Optional Features 11 and 12, ADR 36.
     */
    describe('delivered', () => {
      beforeEach(() => {
        prisma.order.findFirst.mockResolvedValue(
          anOrder({ status: 'shipped' }),
        );
        prisma.order.findUniqueOrThrow.mockResolvedValue(
          anOrderWithDetail({
            ...anOrder({ status: 'delivered', deliveredById: 77 }),
          }),
        );
      });

      it('writes the status and the delivery person in one conditional update', async () => {
        const order = await service.setOrderStatus(
          AS_DELIVERY,
          DELIVERY_ABILITY,
          501,
          { status: 'delivered' },
        );

        expect(nthArg(prisma.order.updateMany)).toEqual({
          where: { id: 501, status: 'shipped' },
          data: { status: 'delivered', deliveredById: 77 },
        });
        expect(nthArg(prisma.orderStatusChange.create)).toEqual({
          data: { orderId: 501, status: 'delivered' },
        });
        expect(order.status).toBe('delivered');
      });

      it('reads the order through the delivery read rules, not the owner one', async () => {
        await service.setOrderStatus(AS_DELIVERY, DELIVERY_ABILITY, 501, {
          status: 'delivered',
        });

        const call = nthArg(prisma.order.findFirst) as { where: unknown };
        expect(call.where).toEqual({
          id: 501,
          AND: [
            {
              OR: [
                { status: 'delivered', deliveredById: 77 },
                { status: 'shipped' },
                { userId: 77 },
              ],
            },
          ],
        });
      });

      it('answers 403 to a delivery person sending any other status', async () => {
        await expect(
          service.setOrderStatus(AS_DELIVERY, DELIVERY_ABILITY, 501, {
            status: 'cancelled',
          }),
        ).rejects.toMatchObject({ status: 403 });
        await expect(
          service.setOrderStatus(AS_DELIVERY, DELIVERY_ABILITY, 501, {
            status: 'processing',
          }),
        ).rejects.toMatchObject({ status: 403 });
        expect(prisma.order.updateMany).not.toHaveBeenCalled();
      });

      it('answers 403 to a client sending delivered on their own order', async () => {
        prisma.order.findFirst.mockResolvedValue(
          anOrder({ userId: 128, status: 'shipped' }),
        );

        await expect(
          service.setOrderStatus(AS_CLIENT, CLIENT_ABILITY, 501, {
            status: 'delivered',
          }),
        ).rejects.toMatchObject({ status: 403 });
        expect(prisma.order.updateMany).not.toHaveBeenCalled();
      });

      it('lets a manager deliver, and records the manager as the deliverer', async () => {
        await service.setOrderStatus(AS_MANAGER, MANAGER_ABILITY, 501, {
          status: 'delivered',
        });

        expect(nthArg(prisma.order.updateMany)).toEqual({
          where: { id: 501, status: 'shipped' },
          data: { status: 'delivered', deliveredById: 1 },
        });
      });

      // The control: every other move writes the status alone, so the column
      // says "delivered by", not "last touched by".
      it('writes no deliverer on a move that is not a delivery', async () => {
        prisma.order.findFirst.mockResolvedValue(anOrder({ status: 'paid' }));

        await service.setOrderStatus(AS_MANAGER, MANAGER_ABILITY, 501, {
          status: 'processing',
        });

        expect(nthArg(prisma.order.updateMany)).toEqual({
          where: { id: 501, status: 'paid' },
          data: { status: 'processing' },
        });
      });
    });
  });

  /**
   * The delivery list. One scope, two statuses, and the ability decides which
   * delivered rows a caller sees, so the service adds the status filter and
   * nothing else. Optional Feature 11.
   */
  describe('listDeliveries', () => {
    const page = { limit: 20, offset: 0 };

    beforeEach(() => {
      prisma.order.findMany.mockResolvedValue([anOrderWithSummary()]);
      prisma.order.count.mockResolvedValue(1);
    });

    /**
     * The scope is the `deliver` rules and not the `read` ones. The read set
     * carries the caller's own purchases, so under `?status=delivered` an
     * order this courier bought and a colleague delivered would appear in
     * their own delivery history. `{ userId: 77 }` must not be here.
     */
    it('scopes on the deliver rules, not the read rules', async () => {
      await service.listDeliveries(AS_DELIVERY, DELIVERY_ABILITY, {
        ...page,
        status: 'shipped',
      });

      const call = nthArg(prisma.order.findMany) as { where: unknown };
      expect(call.where).toEqual({
        status: 'shipped',
        AND: [
          {
            OR: [
              { status: 'delivered', deliveredById: 77 },
              { status: 'shipped' },
            ],
          },
        ],
      });
    });

    it('reads the history under the same where, with the other status', async () => {
      await service.listDeliveries(AS_DELIVERY, DELIVERY_ABILITY, {
        ...page,
        status: 'delivered',
      });

      const call = nthArg(prisma.order.findMany) as {
        where: { AND: { OR: unknown[] }[] };
      };
      expect(call.where).toMatchObject({ status: 'delivered' });
      expect(call.where.AND[0].OR).not.toContainEqual({ userId: 77 });
      expect(nthArg(prisma.order.count)).toEqual({ where: call.where });
    });

    it('pages newest first, and gives a delivery person no customer', async () => {
      const result = await service.listDeliveries(
        AS_DELIVERY,
        DELIVERY_ABILITY,
        { limit: 5, offset: 10, status: 'shipped' },
      );

      const call = nthArg(prisma.order.findMany) as {
        orderBy: unknown;
        take: number;
        skip: number;
      };
      expect(call.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
      expect(call.take).toBe(5);
      expect(call.skip).toBe(10);
      expect(result.meta).toEqual({ total: 1, limit: 5, offset: 10 });
      expect(result.data[0]).not.toHaveProperty('customer');
    });
  });
});
