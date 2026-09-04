import { Test } from '@nestjs/testing';
import { PromoCodesService } from './promo-codes.service';
import type { PrismaMock } from '../prisma/prisma.service.mock';
import {
  createPrismaMock,
  prismaMockProvider,
} from '../prisma/prisma.service.mock';
import { aPromoCode } from './promo-codes.fixtures';
import { nthArg } from '../common/mock-args';
import { Prisma } from '../generated/prisma/client';
import { PageQueryDto } from '../common/dto/page-query.dto';

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.10.0',
  });

/**
 * The three promo code operations. The database arbitrates the taken code, so
 * these cases pin what the service does with the violation rather than which
 * spellings collide; `test/promo-codes.e2e-spec.ts` proves the collision.
 */
describe('PromoCodesService', () => {
  let service: PromoCodesService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = createPrismaMock();

    const module = await Test.createTestingModule({
      providers: [PromoCodesService, prismaMockProvider(prisma)],
    }).compile();

    service = module.get(PromoCodesService);
  });

  const query = (over: Partial<PageQueryDto> = {}) =>
    Object.assign(new PageQueryDto(), over);

  describe('createPromoCode', () => {
    beforeEach(() => {
      prisma.promoCode.create.mockResolvedValue(aPromoCode());
    });

    it('writes the code, the type and the value, and enables nothing by hand', async () => {
      await service.createPromoCode({
        code: 'SAVE10',
        discountType: 'percentage',
        discountValue: 10,
      });

      const call = nthArg(prisma.promoCode.create) as {
        data: Record<string, unknown>;
      };
      // `isActive` and `usedCount` are absent: the column defaults carry both,
      // so a create cannot ship a code that is disabled or already spent.
      expect(call.data).toEqual({
        code: 'SAVE10',
        discountType: 'percentage',
        discountValue: 10,
        expiresAt: undefined,
        usageLimit: undefined,
        minPurchaseCents: undefined,
      });
    });

    it('maps the three optional rules onto their columns', async () => {
      await service.createPromoCode({
        code: 'BIGSPEND',
        discountType: 'fixed',
        discountValue: 500,
        expiresAt: '2026-12-31T23:59:59.000Z',
        usageLimit: 100,
        minPurchase: 5000,
      });

      const call = nthArg(prisma.promoCode.create) as {
        data: { expiresAt: Date; usageLimit: number; minPurchaseCents: number };
      };
      expect(call.data.expiresAt).toEqual(new Date('2026-12-31T23:59:59.000Z'));
      expect(call.data.usageLimit).toBe(100);
      // The wire name is `minPurchase` and the column is `min_purchase_cents`,
      // the split every other amount in this API makes.
      expect(call.data.minPurchaseCents).toBe(5000);
    });

    it('answers 409 when the code is taken', async () => {
      prisma.promoCode.create.mockRejectedValue(uniqueViolation());

      await expect(
        service.createPromoCode({
          code: 'SAVE10',
          discountType: 'percentage',
          discountValue: 10,
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('lets any other database error through', async () => {
      prisma.promoCode.create.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.createPromoCode({
          code: 'SAVE10',
          discountType: 'percentage',
          discountValue: 10,
        }),
      ).rejects.toThrow('connection lost');
    });
  });

  describe('listPromoCodes', () => {
    beforeEach(() => {
      prisma.promoCode.findMany.mockResolvedValue([aPromoCode()]);
      prisma.promoCode.count.mockResolvedValue(1);
    });

    it('reads one page newest first, with no filter', async () => {
      await service.listPromoCodes(query({ limit: 10, offset: 20 }));

      const call = nthArg(prisma.promoCode.findMany) as Record<string, unknown>;
      // No `where`. A disabled code and an expired one stay in the list,
      // because a manager reads this list to find them.
      expect(call).toEqual({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10,
        skip: 20,
      });
    });

    it('reports the total beside the page', async () => {
      prisma.promoCode.count.mockResolvedValue(7);

      const result = await service.listPromoCodes(
        query({ limit: 10, offset: 20 }),
      );

      expect(result.meta).toEqual({ total: 7, limit: 10, offset: 20 });
      expect(result.data[0].usedCount).toBe(0);
    });

    it('carries the used count of each row', async () => {
      prisma.promoCode.findMany.mockResolvedValue([
        aPromoCode({ usedCount: 3 }),
      ]);

      const result = await service.listPromoCodes(query());

      expect(result.data[0].usedCount).toBe(3);
    });
  });

  describe('updatePromoCode', () => {
    beforeEach(() => {
      prisma.promoCode.findUnique.mockResolvedValue(aPromoCode());
      prisma.promoCode.update.mockResolvedValue(aPromoCode());
    });

    it('answers 404 when no row carries the id', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(null);

      await expect(
        service.updatePromoCode(404, { isActive: false }),
      ).rejects.toMatchObject({ status: 404 });

      expect(prisma.promoCode.update).not.toHaveBeenCalled();
    });

    it('disables a code', async () => {
      prisma.promoCode.update.mockResolvedValue(
        aPromoCode({ isActive: false }),
      );

      const result = await service.updatePromoCode(4, { isActive: false });

      const call = nthArg(prisma.promoCode.update) as {
        where: { id: number };
        data: Record<string, unknown>;
      };
      expect(call.where).toEqual({ id: 4 });
      expect(call.data.isActive).toBe(false);
      expect(result.isActive).toBe(false);
    });

    it('enables a code again', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(
        aPromoCode({ isActive: false }),
      );
      prisma.promoCode.update.mockResolvedValue(aPromoCode({ isActive: true }));

      const result = await service.updatePromoCode(4, { isActive: true });

      const call = nthArg(prisma.promoCode.update) as {
        data: Record<string, unknown>;
      };
      expect(call.data.isActive).toBe(true);
      expect(result.isActive).toBe(true);
    });

    it('writes only the fields the body named', async () => {
      await service.updatePromoCode(4, { isActive: false });

      const call = nthArg(prisma.promoCode.update) as {
        data: Record<string, unknown>;
      };
      // Every other key is `undefined`, which Prisma reads as "not provided".
      // A `null` here would clear the column instead.
      expect(call.data).toEqual({
        code: undefined,
        discountType: undefined,
        discountValue: undefined,
        expiresAt: undefined,
        usageLimit: undefined,
        minPurchaseCents: undefined,
        isActive: false,
      });
    });

    it('answers 409 when the new code is taken', async () => {
      prisma.promoCode.update.mockRejectedValue(uniqueViolation());

      await expect(
        service.updatePromoCode(4, { code: 'SAVE20' }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('lets any other database error through', async () => {
      prisma.promoCode.update.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.updatePromoCode(4, { isActive: false }),
      ).rejects.toThrow('connection lost');
    });
  });
});
