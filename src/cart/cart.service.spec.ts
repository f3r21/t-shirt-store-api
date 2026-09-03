import { Test } from '@nestjs/testing';
import { CartService } from './cart.service';
import type { PrismaMock } from '../prisma/prisma.service.mock';
import {
  createPrismaMock,
  prismaMockProvider,
} from '../prisma/prisma.service.mock';
import { aVariant } from '../products/products.fixtures';
import { aCartLine } from './cart.fixtures';
import { nthArg } from '../common/mock-args';
import type { ProblemException } from '../common/problem/problem.exception';
import { ProblemType } from '../common/problem/problem-type';

const USER = 128;

/** Run a call that is expected to throw, and hand the error back typed. */
const caught = (run: () => Promise<unknown>) =>
  run()
    .then(() => null)
    .catch((e: unknown) => e as ProblemException);

describe('CartService', () => {
  let service: CartService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = createPrismaMock();
    const module = await Test.createTestingModule({
      providers: [CartService, prismaMockProvider(prisma)],
    }).compile();
    service = module.get(CartService);
  });

  describe('getCart', () => {
    it('answers an empty cart, not a 404, for a user with no rows', async () => {
      await expect(service.getCart(USER)).resolves.toEqual({
        items: [],
        subtotal: 0,
      });
    });

    it('reads only this user, and only lines whose product is on sale', async () => {
      await service.getCart(USER);

      const call = nthArg(prisma.cartItem.findMany) as {
        where: {
          userId: number;
          variant: { product: { deletedAt: null; isActive: boolean } };
        };
        orderBy: unknown;
      };
      expect(call.where.userId).toBe(USER);
      // The catalog's own predicate for an anonymous viewer: a line for a
      // product since disabled or deleted leaves the view rather than showing
      // something that cannot be bought.
      expect(call.where.variant.product).toEqual({
        deletedAt: null,
        isActive: true,
      });
      expect(call.orderBy).toEqual([
        { createdAt: 'asc' },
        { variantId: 'asc' },
      ]);
    });

    it('maps the rows and sums the subtotal', async () => {
      prisma.cartItem.findMany.mockResolvedValue([
        aCartLine({ row: { quantity: 2 } }),
        aCartLine({
          row: { quantity: 1 },
          variant: { id: 22, priceCents: 500 },
        }),
      ]);

      const cart = await service.getCart(USER);

      expect(cart.items.map((i) => i.variantId)).toEqual([21, 22]);
      expect(cart.subtotal).toBe(4498);
    });
  });

  describe('addCartItem', () => {
    beforeEach(() => {
      prisma.productVariant.findFirst.mockResolvedValue(aVariant({ stock: 7 }));
    });

    it('resolves the variant through the on-sale predicate, or 404', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.addCartItem(USER, { variantId: 21, quantity: 1 }),
      ).rejects.toMatchObject({ status: 404 });

      const call = nthArg(prisma.productVariant.findFirst) as {
        where: { id: number; product: { deletedAt: null; isActive: boolean } };
      };
      expect(call.where.id).toBe(21);
      expect(call.where.product).toEqual({ deletedAt: null, isActive: true });
      expect(prisma.cartItem.upsert).not.toHaveBeenCalled();
    });

    it('creates the line with the quantity sent when none exists', async () => {
      await service.addCartItem(USER, { variantId: 21, quantity: 3 });

      const call = nthArg(prisma.cartItem.upsert) as {
        where: { userId_variantId: { userId: number; variantId: number } };
        create: { userId: number; variantId: number; quantity: number };
        update: { quantity: number };
      };
      expect(call.where.userId_variantId).toEqual({
        userId: USER,
        variantId: 21,
      });
      expect(call.create).toEqual({ userId: USER, variantId: 21, quantity: 3 });
      expect(call.update).toEqual({ quantity: 3 });
    });

    it('adds to the line that exists, because the body is an amount to add', async () => {
      prisma.cartItem.findUnique.mockResolvedValue({ quantity: 2 });

      await service.addCartItem(USER, { variantId: 21, quantity: 3 });

      const call = nthArg(prisma.cartItem.upsert) as {
        update: { quantity: number };
      };
      expect(call.update.quantity).toBe(5);
    });

    it('answers 409 insufficient-stock when the sum is above the units on hand, and writes nothing', async () => {
      prisma.cartItem.findUnique.mockResolvedValue({ quantity: 5 });

      const err = await caught(() =>
        service.addCartItem(USER, { variantId: 21, quantity: 3 }),
      );

      expect(err?.type).toBe(ProblemType.InsufficientStock);
      expect(err?.getStatus()).toBe(409);
      expect(err?.detail).toBe(
        'This variant has 7 units on hand and the request asks for 8.',
      );
      // The contract's promise: a 409 leaves the cart unchanged.
      expect(prisma.cartItem.upsert).not.toHaveBeenCalled();
    });

    it('accepts a sum equal to the stock', async () => {
      prisma.cartItem.findUnique.mockResolvedValue({ quantity: 4 });

      await service.addCartItem(USER, { variantId: 21, quantity: 3 });

      expect(prisma.cartItem.upsert).toHaveBeenCalledTimes(1);
    });

    it('answers the cart after the write', async () => {
      prisma.cartItem.findMany.mockResolvedValue([
        aCartLine({ row: { quantity: 3 } }),
      ]);

      const cart = await service.addCartItem(USER, {
        variantId: 21,
        quantity: 3,
      });

      expect(cart.items).toHaveLength(1);
      expect(cart.subtotal).toBe(5997);
    });
  });

  describe('setCartItem', () => {
    beforeEach(() => {
      prisma.productVariant.findFirst.mockResolvedValue(aVariant({ stock: 7 }));
    });

    it('answers 404 for a variant whose product is not on sale', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.setCartItem(USER, 21, { quantity: 1 }),
      ).rejects.toMatchObject({ status: 404 });
      expect(prisma.cartItem.upsert).not.toHaveBeenCalled();
    });

    it('writes the quantity sent, absolute, whatever the line held', async () => {
      // The set path never reads the existing line: the value is not a delta.
      await service.setCartItem(USER, 21, { quantity: 1 });

      expect(prisma.cartItem.findUnique).not.toHaveBeenCalled();
      const call = nthArg(prisma.cartItem.upsert) as {
        create: { quantity: number };
        update: { quantity: number };
      };
      expect(call.create.quantity).toBe(1);
      expect(call.update.quantity).toBe(1);
    });

    it('throws insufficient-stock above the units on hand, before any write', async () => {
      const err = await caught(() =>
        service.setCartItem(USER, 21, { quantity: 8 }),
      );

      expect(err?.type).toBe(ProblemType.InsufficientStock);
      expect(err?.getStatus()).toBe(409);
      expect(prisma.cartItem.upsert).not.toHaveBeenCalled();
    });

    it('accepts a quantity equal to the stock', async () => {
      await service.setCartItem(USER, 21, { quantity: 7 });

      expect(prisma.cartItem.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteCartItem', () => {
    it('answers 404 for a variant that does not exist, and deletes nothing', async () => {
      prisma.productVariant.findUnique.mockResolvedValue(null);

      await expect(service.deleteCartItem(USER, 999)).rejects.toMatchObject({
        status: 404,
      });
      expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
    });

    it('resolves the variant by id alone, so a withdrawn product can still be removed', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 21 });

      await service.deleteCartItem(USER, 21);

      const lookup = nthArg(prisma.productVariant.findUnique) as {
        where: Record<string, unknown>;
      };
      expect(lookup.where).toEqual({ id: 21 });
      const call = nthArg(prisma.cartItem.deleteMany) as {
        where: { userId: number; variantId: number };
      };
      expect(call.where).toEqual({ userId: USER, variantId: 21 });
    });

    it('is idempotent: an absent line is deleted again without complaint', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 21 });
      prisma.cartItem.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.deleteCartItem(USER, 21)).resolves.toBeUndefined();
    });
  });

  describe('clearCart', () => {
    it('deletes every line of this user and nobody else', async () => {
      await service.clearCart(USER);

      const call = nthArg(prisma.cartItem.deleteMany) as {
        where: Record<string, unknown>;
      };
      expect(call.where).toEqual({ userId: USER });
    });
  });
});
