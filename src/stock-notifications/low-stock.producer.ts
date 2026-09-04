import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { crossesLowStock, StockChange } from './low-stock';
import { LOW_STOCK_JOB, STOCK_QUEUE } from './stock-queue';
import type { StockQueue } from './stock-queue';

/**
 * The longest a call on the queue may hold its caller, whether that caller is
 * a writer whose transaction has committed or the exit. The connection rejects
 * at once while it is down, so this covers the other shape: a command that
 * reached Redis and never came back.
 */
const QUEUE_TIMEOUT_MS = 2000;

/**
 * The producer: who to tell, decided after the commit, one job per person.
 * Nothing here throws. The audience is three clauses: liked the variant, no
 * `stock_notifications` row, no line in a paid order. The job id
 * `low-stock:<variant>:<user>` collapses two crossings before the worker
 * runs. ADR 27.
 */
@Injectable()
export class LowStockProducer implements OnApplicationShutdown {
  private readonly logger = new Logger(LowStockProducer.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STOCK_QUEUE) private readonly queue: StockQueue,
  ) {}

  /** Enqueue for every change that crossed the threshold. Never throws. */
  async notify(changes: readonly StockChange[]): Promise<void> {
    for (const change of changes) {
      if (crossesLowStock(change)) {
        await this.enqueueFor(change);
      }
    }
  }

  private async enqueueFor(change: StockChange): Promise<void> {
    const { variantId } = change;
    try {
      const recipients = await this.prisma.user.findMany({
        where: {
          likes: { some: { variantId } },
          stockAlerts: { none: { variantId } },
          orders: {
            none: {
              status: { notIn: ['pending', 'cancelled'] },
              items: { some: { variantId } },
            },
          },
        },
        select: { id: true },
      });

      const jobIds: string[] = [];
      for (const { id: userId } of recipients) {
        const jobId = `${LOW_STOCK_JOB}:${variantId}:${userId}`;
        await this.bounded(
          this.queue.add(LOW_STOCK_JOB, { variantId, userId }, { jobId }),
        );
        jobIds.push(jobId);
      }

      // The request id is on this line through the logger, and the job ids
      // are its payload, which is how a mail is traced back to the write.
      this.logger.log({
        msg: 'stock crossed the low threshold',
        event: 'stock.low',
        variantId,
        before: change.before,
        after: change.after,
        recipients: recipients.length,
        jobIds,
      });
    } catch (err) {
      this.logger.error({
        msg: 'could not enqueue the low-stock notifications',
        event: 'stock.notify-failed',
        variantId,
        err,
      });
    }
  }

  /** The queue's answer, or a rejection once the bound has passed. */
  private bounded<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const expiry = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `the queue did not answer in ${QUEUE_TIMEOUT_MS} milliseconds`,
            ),
          ),
        QUEUE_TIMEOUT_MS,
      );
    });

    return Promise.race([work, expiry]).finally(() => clearTimeout(timer));
  }

  /**
   * Release the connection at the exit, without holding the exit up.
   *
   * A close sends `QUIT`, which a connection that cannot write refuses, and
   * that leaves the socket behind. `disconnect` drops the socket, but it waits
   * for an `end` that one between reconnects never sends, so it takes the same
   * bound the enqueue takes.
   */
  async onApplicationShutdown(): Promise<void> {
    try {
      await this.queue.close();
    } catch (err) {
      this.logger.error({
        msg: 'the stock queue did not close cleanly',
        event: 'stock.queue-close-failed',
        err,
      });
      // The socket is dropped by the call itself, so a bound that passes has
      // nothing left to release and nothing to report.
      await this.bounded(this.queue.disconnect()).catch(() => undefined);
    }
  }
}
