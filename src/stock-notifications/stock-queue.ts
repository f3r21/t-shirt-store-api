import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { EnvironmentVariables } from '../config/env.validation';

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
 * The two calls the producer makes on the queue. Narrow on purpose, like
 * `StripeClient`: a spec hands the producer a plain object with these two
 * methods, and the boot test replaces the token so `compile()` opens no socket.
 */
export interface StockQueue {
  add(
    name: typeof LOW_STOCK_JOB,
    data: LowStockJob,
    opts: { jobId: string },
  ): Promise<unknown>;
  close(): Promise<void>;
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
 */
export const stockQueueProvider: Provider = {
  provide: STOCK_QUEUE,
  inject: [ConfigService],
  useFactory: (config: ConfigService<EnvironmentVariables, true>): StockQueue =>
    new Queue(STOCK_QUEUE_NAME, {
      connection: { url: config.getOrThrow<string>('REDIS_URL') },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
};
