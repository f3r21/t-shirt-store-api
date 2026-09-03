import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LowStockProducer } from './low-stock.producer';
import { STOCK_QUEUE } from './stock-queue';
import type { PrismaMock } from '../prisma/prisma.service.mock';
import {
  createPrismaMock,
  prismaMockProvider,
} from '../prisma/prisma.service.mock';
import { nthArg } from '../common/mock-args';

/**
 * The producer: the audience query, one job per row with its id, and the
 * promise that it never throws at a writer whose transaction has committed.
 */
describe('LowStockProducer', () => {
  let producer: LowStockProducer;
  let prisma: PrismaMock;
  let queue: { add: jest.Mock; close: jest.Mock };
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(async () => {
    prisma = createPrismaMock();
    queue = {
      add: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const module = await Test.createTestingModule({
      providers: [
        LowStockProducer,
        prismaMockProvider(prisma),
        { provide: STOCK_QUEUE, useValue: queue },
      ],
    }).compile();
    producer = module.get(LowStockProducer);
    // Cleared after `compile()`, which writes through the same prototype.
    log.mockClear();
    error.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('enqueues one job per recipient when a write crosses the threshold, with a deterministic id', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 128 }, { id: 7 }]);

    await producer.notify([{ variantId: 21, before: 4, after: 3 }]);

    expect(nthArg(prisma.user.findMany)).toEqual({
      where: {
        likes: { some: { variantId: 21 } },
        stockAlerts: { none: { variantId: 21 } },
        orders: {
          none: {
            status: { notIn: ['pending', 'cancelled'] },
            items: { some: { variantId: 21 } },
          },
        },
      },
      select: { id: true },
    });
    expect(queue.add.mock.calls).toEqual([
      [
        'low-stock',
        { variantId: 21, userId: 128 },
        { jobId: 'low-stock:21:128' },
      ],
      ['low-stock', { variantId: 21, userId: 7 }, { jobId: 'low-stock:21:7' }],
    ]);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'stock.low',
        variantId: 21,
        before: 4,
        after: 3,
        recipients: 2,
        jobIds: ['low-stock:21:128', 'low-stock:21:7'],
      }),
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('runs no query and enqueues nothing when no write crosses', async () => {
    await producer.notify([
      { variantId: 21, before: 3, after: 2 },
      { variantId: 22, before: 5, after: 4 },
      { variantId: 23, before: 1, after: 3 },
    ]);

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('logs at error and resolves when the queue cannot be reached', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 128 }]);
    queue.add.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(
      producer.notify([{ variantId: 21, before: 4, after: 0 }]),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'stock.notify-failed', variantId: 21 }),
    );
    expect(log).not.toHaveBeenCalled();
  });

  it('closes the queue when the application shuts down', async () => {
    await producer.onApplicationShutdown();

    expect(queue.close).toHaveBeenCalledTimes(1);
  });
});
