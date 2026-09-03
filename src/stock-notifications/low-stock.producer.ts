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
 * The producer: who to tell, decided at the write, one job per person.
 *
 * Called by both stock writers after their transaction committed, never inside
 * it. The page says the enqueue waits for the commit so a queue outage cannot
 * fail a paid order, and names the gap that leaves: a crash between the commit
 * and the enqueue loses the job. So nothing here throws. A queue that cannot be
 * reached is a line at error, and the writer's answer stands.
 *
 * **The audience is three clauses.** Liked this variant; no
 * `stock_notifications` row for it, which the worker writes before it mails;
 * and no line for it in an order that is paid or later, because a pending
 * order reserves nothing and a cancelled one bought nothing. The buyer whose
 * payment caused the crossing is excluded by the third clause, since their
 * order is `paid` by the time this runs.
 *
 * **One job per recipient, with a deterministic id.** `low-stock:<variant>:<user>`,
 * so two crossings before the worker runs, a manager setting the stock twice
 * say, leave one job: BullMQ ignores an add whose id already exists. A
 * completed job is removed and its id freed, and the row the worker wrote is
 * what stops a second mail then. A job that failed its attempts keeps its id
 * in the failed set until somebody clears it, which is the alert the page
 * names. ADR 27.
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
        await this.queue.add(LOW_STOCK_JOB, { variantId, userId }, { jobId });
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

  onApplicationShutdown(): Promise<void> {
    return this.queue.close();
  }
}
