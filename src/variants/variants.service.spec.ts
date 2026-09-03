import { Test } from '@nestjs/testing';
import { VariantsService } from './variants.service';
import type { PrismaMock } from '../prisma/prisma.service.mock';
import {
  createPrismaMock,
  prismaMockProvider,
} from '../prisma/prisma.service.mock';
import { aProduct, aVariant } from '../products/products.fixtures';
import { nthArg } from '../common/mock-args';
import { Prisma } from '../generated/prisma/client';
import { LowStockProducer } from '../stock-notifications/low-stock.producer';

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.10.0',
  });

describe('VariantsService', () => {
  let service: VariantsService;
  let prisma: PrismaMock;
  let notify: jest.Mock;

  beforeEach(async () => {
    prisma = createPrismaMock();
    notify = jest.fn().mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      providers: [
        VariantsService,
        prismaMockProvider(prisma),
        { provide: LowStockProducer, useValue: { notify } },
      ],
    }).compile();
    service = module.get(VariantsService);
  });

  describe('createVariant', () => {
    beforeEach(() => {
      prisma.product.findFirst.mockResolvedValue(aProduct());
      prisma.productVariant.create.mockResolvedValue(aVariant());
    });

    it('answers 404 when the product is deleted or does not exist', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.createVariant(7, { price: 1999, stock: 5 }),
      ).rejects.toMatchObject({ status: 404 });

      // The resolve is not decoration: without it a bad id reaches the insert
      // and raises a foreign key violation, which nothing maps, so the caller
      // would read 500.
      expect(prisma.productVariant.create).not.toHaveBeenCalled();
    });

    it('lets a manager add a variant to a disabled product', async () => {
      await service.createVariant(7, { price: 1999, stock: 5 });

      const call = nthArg(prisma.product.findFirst) as {
        where: { deletedAt: null; isActive?: boolean };
      };
      // Deleted is filtered, disabled is not: disabling is how you take
      // something off sale while you fix it.
      expect(call.where.deletedAt).toBeNull();
      expect(call.where).not.toHaveProperty('isActive');
    });

    it('stores an absent size or colour as the empty string', async () => {
      await service.createVariant(7, { price: 1999, stock: 5 });

      const call = nthArg(prisma.productVariant.create) as {
        data: { size: string; color: string };
      };
      // Not null. PostgreSQL treats two NULLs in a unique index as distinct, so
      // nullable columns would admit two variants with no size and no colour on
      // one product, which the contract answers with a 409.
      expect(call.data.size).toBe('');
      expect(call.data.color).toBe('');
    });

    it('answers 409 when the product already has that size and colour', async () => {
      prisma.productVariant.create.mockRejectedValue(uniqueViolation());

      const err = await service
        .createVariant(7, { size: 'M', color: 'black', price: 1999, stock: 5 })
        .then(() => null)
        .catch((e: unknown) => e as { getStatus(): number });

      expect(err?.getStatus()).toBe(409);
    });

    it('writes the price into the minor unit column', async () => {
      await service.createVariant(7, { price: 1999, stock: 5 });

      const call = nthArg(prisma.productVariant.create) as {
        data: { priceCents: number };
      };
      expect(call.data.priceCents).toBe(1999);
    });
  });

  describe('updateVariant', () => {
    beforeEach(() => {
      prisma.productVariant.findFirst.mockResolvedValue(aVariant());
      prisma.productVariant.update.mockResolvedValue(aVariant());
    });

    it('never writes stock, because stock has its own operation', async () => {
      await service.updateVariant(21, {
        size: 'L',
        color: 'white',
        price: 2999,
      });

      const call = nthArg(prisma.productVariant.update) as {
        data: Record<string, unknown>;
      };
      expect(call.data).not.toHaveProperty('stock');
    });

    it('leaves a field alone when the body omits it', async () => {
      await service.updateVariant(21, { price: 2999 });

      const call = nthArg(prisma.productVariant.update) as {
        data: Record<string, unknown>;
      };
      expect(Object.keys(call.data)).toEqual(['priceCents']);
    });

    it('answers 404 when the variant belongs to a deleted product', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.updateVariant(21, { price: 2999 }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('answers 409 when the edit collides with another variant', async () => {
      prisma.productVariant.update.mockRejectedValue(uniqueViolation());

      const err = await service
        .updateVariant(21, { size: 'L' })
        .then(() => null)
        .catch((e: unknown) => e as { getStatus(): number });

      expect(err?.getStatus()).toBe(409);
    });
  });

  describe('setVariantStock', () => {
    it('sets an absolute value rather than applying a delta', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(aVariant({ stock: 7 }));
      prisma.productVariant.update.mockResolvedValue(aVariant({ stock: 3 }));

      const result = await service.setVariantStock(21, { stock: 3 });

      const call = nthArg(prisma.productVariant.update) as {
        data: { stock: number };
      };
      // 3, not 7 minus 3. The caller is a person doing a stock count.
      expect(call.data.stock).toBe(3);
      expect(result.stock).toBe(3);
      // The second stock writer hands the pair over once the write is done.
      expect(notify).toHaveBeenCalledWith([
        { variantId: 21, before: 7, after: 3 },
      ]);
      expect(notify.mock.invocationCallOrder[0]).toBeGreaterThan(
        prisma.productVariant.update.mock.invocationCallOrder[0],
      );
    });

    it('answers 404 for a variant that is not visible', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.setVariantStock(21, { stock: 3 }),
      ).rejects.toMatchObject({ status: 404 });
      expect(notify).not.toHaveBeenCalled();
    });
  });

  describe('deleteVariant', () => {
    it('deletes the row when no order line points at it', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(aVariant());
      prisma.productVariant.delete.mockResolvedValue(aVariant());

      await service.deleteVariant(21);

      expect(prisma.productVariant.delete).toHaveBeenCalledWith({
        where: { id: 21 },
      });
    });

    it('answers 404 for a variant that is not visible', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(service.deleteVariant(21)).rejects.toMatchObject({
        status: 404,
      });
    });

    /** The contract's 409 on `deleteVariant`: order history points at the row. */
    it('answers 409 when an order line points at the variant', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(aVariant());
      prisma.orderItem.count.mockResolvedValue(1);

      await expect(service.deleteVariant(21)).rejects.toMatchObject({
        status: 409,
      });
      // Refused before the write, not after it failed.
      expect(prisma.productVariant.delete).not.toHaveBeenCalled();
    });

    it('counts the order lines of this variant and no other', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(aVariant());
      prisma.productVariant.delete.mockResolvedValue(aVariant());

      await service.deleteVariant(21);

      expect(prisma.orderItem.count).toHaveBeenCalledWith({
        where: { variantId: 21 },
      });
    });

    /**
     * The race the count cannot close, and the reason the catch exists. An order
     * placed between the count and the delete reaches `onDelete: Restrict`, and
     * without this branch that arrives as an unmapped `P2003`, which is a 500
     * where the contract declares a 409. Same shape as the unique index catch in
     * `users.service.ts:81-89`.
     */
    it('turns the foreign key refusal into the same 409, not a 500', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(aVariant());
      prisma.productVariant.delete.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('fk', {
          code: 'P2003',
          clientVersion: 'test',
        }),
      );

      await expect(service.deleteVariant(21)).rejects.toMatchObject({
        status: 409,
      });
    });

    it('lets an unrelated database error through untouched', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(aVariant());
      const boom = new Error('connection reset');
      prisma.productVariant.delete.mockRejectedValue(boom);

      // The catch is narrow on purpose. Swallowing every failure here would turn
      // an outage into a 409 and tell the caller to retry a request that cannot
      // succeed.
      await expect(service.deleteVariant(21)).rejects.toBe(boom);
    });
  });
});
