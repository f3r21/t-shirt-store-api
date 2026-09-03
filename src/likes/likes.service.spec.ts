import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { LikesService } from './likes.service';
import { ProductsService } from '../products/products.service';
import type { PrismaMock } from '../prisma/prisma.service.mock';
import {
  createPrismaMock,
  prismaMockProvider,
} from '../prisma/prisma.service.mock';
import { AS_CLIENT, AS_MANAGER, aVariant } from '../products/products.fixtures';
import { nthArg } from '../common/mock-args';
import { AbilityFactory } from '../authz/ability.factory';
import { PageQueryDto } from '../common/dto/page-query.dto';

const abilities = new AbilityFactory();
const CLIENT = abilities.for(AS_CLIENT);
const MANAGER = abilities.for(AS_MANAGER);

const VARIANT = 340;

/**
 * The three like operations.
 *
 * What this file pins is the two lookups and the two writes: the like resolves
 * a variant on sale and the unlike a variant that exists, the upsert has
 * nothing to update, the delete ignores its count, and the list hands the page
 * assembler the caller's own visibility with the likes predicate added.
 */
describe('LikesService', () => {
  let service: LikesService;
  let prisma: PrismaMock;
  let pageOf: jest.Mock;

  beforeEach(async () => {
    prisma = createPrismaMock();
    pageOf = jest.fn().mockResolvedValue({
      data: [],
      meta: { total: 0, limit: 20, offset: 0 },
    });

    const module = await Test.createTestingModule({
      providers: [
        LikesService,
        prismaMockProvider(prisma),
        { provide: ProductsService, useValue: { pageOf } },
      ],
    }).compile();

    service = module.get(LikesService);
  });

  describe('likeVariant', () => {
    it('resolves the variant through the on-sale predicate, then upserts the pair', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(aVariant());

      await service.likeVariant(AS_CLIENT, VARIANT);

      expect(nthArg(prisma.productVariant.findFirst)).toEqual({
        where: { id: VARIANT, product: { deletedAt: null, isActive: true } },
        select: { id: true },
      });
      expect(nthArg(prisma.productLike.upsert)).toEqual({
        where: { userId_variantId: { userId: 128, variantId: VARIANT } },
        create: { userId: 128, variantId: VARIANT },
        update: {},
      });
    });

    it('answers 404 and writes nothing when no variant on sale has the id', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.likeVariant(AS_CLIENT, VARIANT),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.productLike.upsert).not.toHaveBeenCalled();
    });
  });

  describe('unlikeVariant', () => {
    it('needs only a variant that exists, and deletes whatever is there', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(aVariant());
      prisma.productLike.deleteMany.mockResolvedValue({ count: 0 });

      await service.unlikeVariant(AS_CLIENT, VARIANT);

      expect(nthArg(prisma.productVariant.findFirst)).toEqual({
        where: { id: VARIANT, product: { deletedAt: null } },
        select: { id: true },
      });
      expect(nthArg(prisma.productLike.deleteMany)).toEqual({
        where: { userId: 128, variantId: VARIANT },
      });
    });

    it('answers 404 and deletes nothing when no variant has the id', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.unlikeVariant(AS_CLIENT, VARIANT),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.productLike.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('listLikedProducts', () => {
    const query = Object.assign(new PageQueryDto(), { limit: 5, offset: 10 });
    const mine = { variants: { some: { likes: { some: { userId: 128 } } } } };

    it('pages the products a client likes under the shopper visibility', async () => {
      await service.listLikedProducts(AS_CLIENT, CLIENT, query);

      expect(pageOf).toHaveBeenCalledWith(
        { AND: [{ OR: [{ deletedAt: null, isActive: true }] }, mine] },
        query,
      );
    });

    it('lets a manager see a liked product they disabled', async () => {
      const asManager = { ...AS_MANAGER, sub: 128 };

      await service.listLikedProducts(
        asManager,
        abilities.for(asManager),
        query,
      );

      expect(pageOf).toHaveBeenCalledWith(
        {
          AND: [
            { OR: [{ deletedAt: null }, { deletedAt: null, isActive: true }] },
            mine,
          ],
        },
        query,
      );
      expect(MANAGER.can('manage', 'ProductLike')).toBe(true);
    });
  });
});
