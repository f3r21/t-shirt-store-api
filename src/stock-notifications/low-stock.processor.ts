import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { MAILER } from '../mail/mailer';
import type { Mailer } from '../mail/mailer';
import type { LowStockJob } from './stock-queue';

/**
 * The consumer: one job, one person, one mail, once. The row first, so two
 * workers holding the same pair meet the primary key; on a failed lookup or
 * send the row is deleted and the error thrown again, so the next attempt
 * sends. ADR 28.
 */
@Injectable()
export class LowStockProcessor {
  private readonly logger = new Logger(LowStockProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  async process(job: LowStockJob): Promise<void> {
    const { userId, variantId } = job;

    try {
      await this.prisma.stockNotification.create({
        data: { userId, variantId },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') {
          this.logger.log({
            msg: 'this person was already told',
            event: 'stock.notified-already',
            userId,
            variantId,
          });
          return;
        }
        if (err.code === 'P2003') {
          this.skipped(userId, variantId);
          return;
        }
      }
      throw err;
    }

    // Everything after the row is inside one try: a rejection anywhere, the
    // lookup or the send, takes the row back and throws again, so the next
    // attempt can send. A row left behind would make that attempt read `P2002`
    // as "already told". ADR 28.
    try {
      const [variant, user] = await Promise.all([
        this.prisma.productVariant.findUnique({
          where: { id: variantId },
          include: {
            product: {
              include: {
                images: {
                  where: { isPrimary: true },
                  orderBy: { id: 'asc' },
                  take: 1,
                },
              },
            },
          },
        }),
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { email: true },
        }),
      ]);
      if (variant === null || user === null) {
        await this.forget(userId, variantId);
        this.skipped(userId, variantId);
        return;
      }

      const image = variant.product.images[0];
      await this.mailer.sendLowStock(user.email, {
        productId: variant.productId,
        productName: variant.product.name,
        size: variant.size,
        color: variant.color,
        stock: variant.stock,
        ...(image === undefined ? {} : { imageUrl: image.url }),
      });

      this.logger.log({
        msg: 'low-stock mail sent',
        event: 'stock.notified',
        userId,
        variantId,
        stock: variant.stock,
      });
    } catch (err) {
      await this.forget(userId, variantId);
      throw err;
    }
  }

  /** Remove the row so the next attempt can send. Nothing to remove is fine. */
  private async forget(userId: number, variantId: number): Promise<void> {
    await this.prisma.stockNotification.deleteMany({
      where: { userId, variantId },
    });
  }

  private skipped(userId: number, variantId: number): void {
    this.logger.warn({
      msg: 'the user or the variant is gone',
      event: 'stock.notify-skipped',
      userId,
      variantId,
    });
  }
}
