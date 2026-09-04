import type { FactoryProvider } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { EnvironmentVariables } from '../config/env.validation';

export const STOCK_QUEUE = Symbol('STOCK_QUEUE');

/** The queue's name in Redis, shared by the producer and the worker. */
export const STOCK_QUEUE_NAME = 'stock-notifications';

/** The one job kind. Its data names the variant and the person to tell. */
export const LOW_STOCK_JOB = 'low-stock';

export interface LowStockJob {
  variantId: number;
  userId: number;
}

/**
 * The calls the producer makes on the queue. Narrow on purpose, like
 * `StripeClient`: a spec hands the producer a plain object with these methods,
 * and the boot test replaces the token so `compile()` opens no socket.
 * `disconnect` is the exit's second door, for a close that cannot write.
 */
export interface StockQueue {
  add(
    name: typeof LOW_STOCK_JOB,
    data: LowStockJob,
    opts: { jobId: string },
  ): Promise<unknown>;
  close(): Promise<void>;
  disconnect(): Promise<void>;
}

/**
 * The production binding: BullMQ over ioredis, from `REDIS_URL` alone.
 *
 * `connection: { url }` is handed to ioredis, which reads the host, the port,
 * the password and the database index out of the URL. The job defaults are the
 * page's: three attempts with an exponential backoff from one second, so a mail
 * provider that is down for a moment does not lose the message; a completed
 * job is removed, and a job that failed its attempts stays in the failed set,
 * because the page names that set's size as the thing to watch.
 *
 * The three connection options are one decision: an enqueue must not outlive
 * the request that made it. By default BullMQ waits for `ready` before it runs
 * anything and ioredis holds the command in its offline queue, so a writer
 * whose transaction has already committed waits for as long as Redis is down.
 * With these the queue uses its connection at once and a command sent while
 * the socket is not writable rejects, which is the rejection the producer's
 * `catch` logs as `stock.notify-failed`. A blip at boot loses the jobs
 * enqueued during it, which ADR 27 already accepts.
 */
export const stockQueueProvider: FactoryProvider<StockQueue> = {
  provide: STOCK_QUEUE,
  inject: [ConfigService],
  useFactory: (
    config: ConfigService<EnvironmentVariables, true>,
  ): StockQueue => {
    const logger = new Logger('StockQueue');
    const queue = new Queue(STOCK_QUEUE_NAME, {
      connection: {
        url: config.getOrThrow<string>('REDIS_URL'),
        enableOfflineQueue: false,
      },
      skipWaitingForReady: true,
      // Part of the same decision, and not a relaxed version check: BullMQ
      // sends its version `INFO` in the same tick as the connect, before the
      // socket can be writable, so with the offline queue off that first
      // command rejects and the connection stays rejected for the life of the
      // process.
      skipVersionCheck: true,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });

    // BullMQ forwards the connection's errors here and writes a raw stack
    // trace to stderr when nobody listens. The worker's class does the same
    // for its own connection.
    queue.on('error', (err) => {
      logger.error({
        msg: 'the stock queue lost its connection',
        event: 'stock.queue-error',
        reason: err.message,
      });
    });

    return queue;
  },
};
