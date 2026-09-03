import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ImagesService } from './images.service';
import { OBJECT_STORE } from './object-store';
import type { PrismaMock } from '../prisma/prisma.service.mock';
import {
  createPrismaMock,
  prismaMockProvider,
} from '../prisma/prisma.service.mock';
import { nthArg } from '../common/mock-args';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BASE = 'https://images.test';
const KEY = /^images\/products\/7\/[0-9a-f-]{36}\.png$/;

/**
 * The two operations' order of writes and what each refuses: the object
 * before the row and the row before the object, the primary flag cleared
 * only when asked, and the compensation when the row fails.
 */
describe('ImagesService', () => {
  let service: ImagesService;
  let prisma: PrismaMock;
  let store: { put: jest.Mock; delete: jest.Mock };
  let error: jest.SpyInstance;

  beforeEach(async () => {
    prisma = createPrismaMock();
    store = {
      put: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const module = await Test.createTestingModule({
      providers: [
        ImagesService,
        prismaMockProvider(prisma),
        { provide: OBJECT_STORE, useValue: store },
        { provide: ConfigService, useValue: { getOrThrow: () => `${BASE}/` } },
      ],
    }).compile();
    service = module.get(ImagesService);
    error.mockClear();

    prisma.product.findFirst.mockResolvedValue({ id: 7 });
    prisma.productImage.create.mockImplementation(
      (args: {
        data: { productId: number; url: string; isPrimary: boolean };
      }) => Promise.resolve({ id: 88, ...args.data }),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('upload', () => {
    it('answers 404 for a product that is deleted or missing, and stores nothing', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.upload(7, { buffer: PNG }, false),
      ).rejects.toMatchObject({ status: 404 });

      expect(store.put).not.toHaveBeenCalled();
    });

    it('answers 415 for bytes that are not an image, and stores nothing', async () => {
      await expect(
        service.upload(7, { buffer: Buffer.from('not an image') }, false),
      ).rejects.toMatchObject({ status: 415 });

      expect(store.put).not.toHaveBeenCalled();
      expect(prisma.productImage.create).not.toHaveBeenCalled();
    });

    it('puts the object under a uuid key, then writes the row with its URL', async () => {
      const image = await service.upload(7, { buffer: PNG }, false);

      const [key, body, contentType] = store.put.mock.calls[0] as [
        string,
        Buffer,
        string,
      ];
      expect(key).toMatch(KEY);
      expect(body).toBe(PNG);
      expect(contentType).toBe('image/png');
      expect(nthArg(prisma.productImage.create)).toEqual({
        data: { productId: 7, url: `${BASE}/${key}`, isPrimary: false },
      });
      expect(store.put.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.productImage.create.mock.invocationCallOrder[0],
      );
      expect(prisma.productImage.updateMany).not.toHaveBeenCalled();
      expect(image).toEqual({
        id: 88,
        url: `${BASE}/${key}`,
        isPrimary: false,
      });
    });

    it('clears the previous primary before it writes a new one, when asked', async () => {
      await service.upload(7, { buffer: PNG }, true);

      expect(nthArg(prisma.productImage.updateMany)).toEqual({
        where: { productId: 7, isPrimary: true },
        data: { isPrimary: false },
      });
      expect(
        prisma.productImage.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(prisma.productImage.create.mock.invocationCallOrder[0]);
    });

    it('takes the object back down and rethrows when the row fails', async () => {
      prisma.productImage.create.mockRejectedValue(new Error('row refused'));

      await expect(service.upload(7, { buffer: PNG }, false)).rejects.toThrow(
        'row refused',
      );

      const key = (store.put.mock.calls[0] as [string])[0];
      expect(store.delete).toHaveBeenCalledWith(key);
    });
  });

  describe('remove', () => {
    const row = {
      id: 88,
      productId: 7,
      url: `${BASE}/images/products/7/abc.png`,
      isPrimary: true,
    };

    it('deletes the row, then the object behind its URL', async () => {
      prisma.productImage.findUnique.mockResolvedValue(row);

      await service.remove(88);

      expect(nthArg(prisma.productImage.delete)).toEqual({ where: { id: 88 } });
      expect(store.delete).toHaveBeenCalledWith('images/products/7/abc.png');
      expect(
        prisma.productImage.delete.mock.invocationCallOrder[0],
      ).toBeLessThan(store.delete.mock.invocationCallOrder[0]);
    });

    it('answers 404 for an image that does not exist, and deletes nothing', async () => {
      prisma.productImage.findUnique.mockResolvedValue(null);

      await expect(service.remove(88)).rejects.toMatchObject({ status: 404 });

      expect(prisma.productImage.delete).not.toHaveBeenCalled();
      expect(store.delete).not.toHaveBeenCalled();
    });

    it('keeps the answer and logs an orphan when the object will not go', async () => {
      prisma.productImage.findUnique.mockResolvedValue(row);
      store.delete.mockRejectedValue(new Error('AccessDenied'));

      await expect(service.remove(88)).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'image.orphaned',
          key: 'images/products/7/abc.png',
          imageId: 88,
        }),
      );
    });
  });
});
