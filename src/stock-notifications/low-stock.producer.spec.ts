import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { LowStockProducer } from './low-stock.producer';
import { STOCK_QUEUE, stockQueueProvider } from './stock-queue';
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
  let queue: { add: jest.Mock; close: jest.Mock; disconnect: jest.Mock };
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(async () => {
    prisma = createPrismaMock();
    queue = {
      add: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
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
    jest.useRealTimers();
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

  it('resolves and logs stock.notify-failed when the queue never settles', async () => {
    jest.useFakeTimers();
    prisma.user.findMany.mockResolvedValue([{ id: 128 }]);
    // The shape a Redis outage takes without a bound: the command leaves and
    // the answer never comes back, so the writer's request waits for ever.
    queue.add.mockReturnValue(new Promise(() => undefined));

    const notified = producer.notify([{ variantId: 21, before: 4, after: 3 }]);
    await jest.advanceTimersByTimeAsync(2000);

    await expect(notified).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'stock.notify-failed', variantId: 21 }),
    );
    expect(log).not.toHaveBeenCalled();
  });

  it('closes the queue when the application shuts down', async () => {
    await producer.onApplicationShutdown();

    expect(queue.close).toHaveBeenCalledTimes(1);
    expect(queue.disconnect).not.toHaveBeenCalled();
  });

  it('logs and drops the connection when the close cannot be written', async () => {
    queue.close.mockRejectedValue(
      new Error(
        "Stream isn't writeable and enableOfflineQueue options is false",
      ),
    );

    await expect(producer.onApplicationShutdown()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'stock.queue-close-failed' }),
    );
    expect(queue.disconnect).toHaveBeenCalledTimes(1);
  });
});

/**
 * The production binding, called directly. A closed port is enough: the
 * factory has to attach its listener before anything connects, and the queue
 * is closed again without a Redis ever answering.
 */
describe('the stock queue factory', () => {
  let error: jest.SpyInstance;

  beforeEach(() => {
    error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('attaches an error listener', async () => {
    const queue = stockQueueProvider.useFactory({
      getOrThrow: () => 'redis://127.0.0.1:6399/5',
    }) as unknown as Queue;

    try {
      expect(queue.listenerCount('error')).toBe(1);

      queue.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:6399'));

      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'stock.queue-error',
          reason: 'connect ECONNREFUSED 127.0.0.1:6399',
        }),
      );
    } finally {
      await queue.close();
    }
  });
});
