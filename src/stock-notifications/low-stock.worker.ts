import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import { EnvironmentVariables } from '../config/env.validation';
import { LowStockProcessor } from './low-stock.processor';
import { STOCK_QUEUE_NAME } from './stock-queue';
import type { LowStockJob } from './stock-queue';

/**
 * The queue's consumer, in its own process from the same image, so the API
 * and the worker scale apart. The job's attempts are the retry, and the failed
 * set is the alert. Concurrency five, the mail provider's rate. ADR 28.
 */
@Injectable()
export class LowStockWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(LowStockWorker.name);
  private worker?: Worker<LowStockJob>;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly processor: LowStockProcessor,
  ) {}

  onApplicationBootstrap(): void {
    const worker = new Worker<LowStockJob>(
      STOCK_QUEUE_NAME,
      (job) => this.processor.process(job.data),
      {
        connection: { url: this.config.getOrThrow<string>('REDIS_URL') },
        concurrency: 5,
      },
    );

    worker.on('completed', (job) => {
      this.logger.log({
        msg: 'low-stock job done',
        event: 'stock.job-completed',
        jobId: job.id,
        ...job.data,
      });
    });
    worker.on('failed', (job, err) => {
      this.logger.error({
        msg: 'low-stock job failed',
        event: 'stock.notify-job-failed',
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        attempts: job?.opts.attempts,
        reason: err.message,
        ...(job?.data ?? {}),
      });
    });
    worker.on('error', (err) => {
      this.logger.error({
        msg: 'the worker lost its connection or a lock',
        event: 'stock.worker-error',
        reason: err.message,
      });
    });

    this.worker = worker;
  }

  /** Finish the jobs in flight and release their locks before the exit. */
  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
