import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import type { PaymentMethod } from '../generated/prisma/enums';
import type { AccessTokenPayload } from '../auth/access-token-payload';
import { accessibleBy } from '@casl/prisma';
import type { AppAbility } from '../authz/ability';
import { visibleProductWhere } from '../products/product-visibility';
import { insufficientStock } from '../common/problem/insufficient-stock';
import { StripeGateway } from './stripe.gateway';
import { LowStockProducer } from '../stock-notifications/low-stock.producer';
import type { StockChange } from '../stock-notifications/low-stock';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';
import { PaymentLinkDto } from './dto/payment-link.dto';
import { PaymentIntentDto } from './dto/payment-intent.dto';

/**
 * What applying one event came to, for the log line and for the low-stock
 * producer, which reads `stocks` once the transaction has committed.
 */
type Outcome =
  | { kind: 'duplicate' }
  | { kind: 'orphan'; orderId: number | null }
  | { kind: 'not-applied'; orderId: number; status: string }
  | { kind: 'unpaid'; orderId: number }
  | {
      kind: 'applied';
      orderId: number;
      stocks: StockChange[];
      oversold: { variantId: number; shortfall: number }[];
    };

/**
 * Read the order id an event carries in its metadata. Stripe metadata values
 * are strings, and a value that is not a positive integer names no order.
 */
function orderIdOf(metadata: Stripe.Metadata | null): number | null {
  const raw = metadata?.orderId;
  if (raw === undefined || !/^[1-9][0-9]*$/.test(raw)) {
    return null;
  }
  return Number(raw);
}

/** The line as Stripe's page names it: the product, then the options it has. */
function lineName(variant: {
  size: string;
  color: string;
  product: { name: string };
}): string {
  const options = [variant.size, variant.color].filter((o) => o !== '');
  return options.length === 0
    ? variant.product.name
    : `${variant.product.name} (${options.join(', ')})`;
}

/**
 * The two Stripe flows, and the webhook that applies their result.
 *
 * See `openapi.yaml:1587-1742` and `ARCHITECTURE.md`, "Where a request fails
 * halfway": this file is that seam. The webhook is the only writer of `paid`
 * and of the stock, the event id is inserted first so a retry is a unique
 * violation, and the whole of it is one transaction.
 *
 * **One event kind per flow.** A payment link carries the order id in its own
 * metadata, which Stripe copies to the Checkout Session, so
 * `checkout.session.completed` pays a link order as `payment_link`. A payment
 * intent carries it in its metadata, so `payment_intent.succeeded` pays a cart
 * order as `payment_intent`. The link deliberately puts nothing in
 * `payment_intent_data`, so the intent event a link purchase also fires names
 * no order and is ignored, and each order is paid by exactly one kind.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeGateway,
    private readonly lowStock: LowStockProducer,
  ) {}

  /**
   * An order for one variant, and a Stripe page that sells it.
   *
   * The order is written first, in one nested create, because the link needs
   * the order id in its metadata. If Stripe then fails, the order is deleted
   * (the cascade takes its line and its history) and the error goes to the
   * filter, so a link that was never returned leaves no `pending` order
   * behind. Stock is checked and not touched: it falls on
   * `checkout.session.completed`.
   */
  async createPaymentLink(
    viewer: AccessTokenPayload,
    dto: CreatePaymentLinkDto,
  ): Promise<PaymentLinkDto> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: dto.variantId, product: visibleProductWhere(undefined) },
      include: { product: { select: { name: true } } },
    });
    if (variant === null) {
      throw new NotFoundException();
    }
    if (dto.quantity > variant.stock) {
      throw insufficientStock(variant.stock, dto.quantity);
    }

    const totalCents = variant.priceCents * dto.quantity;
    const order = await this.prisma.order.create({
      data: {
        userId: viewer.sub,
        status: 'pending',
        subtotalCents: totalCents,
        totalCents,
        items: {
          create: {
            variantId: variant.id,
            productId: variant.productId,
            productName: variant.product.name,
            size: variant.size,
            color: variant.color,
            unitPriceCents: variant.priceCents,
            quantity: dto.quantity,
          },
        },
        statusHistory: { create: { status: 'pending' } },
      },
      select: { id: true },
    });

    try {
      const link = await this.stripe.createPaymentLink({
        orderId: order.id,
        name: lineName(variant),
        unitAmount: variant.priceCents,
        quantity: dto.quantity,
      });
      this.logger.log({
        msg: 'payment link created',
        event: 'payment.link-created',
        orderId: order.id,
        userId: viewer.sub,
        amount: totalCents,
      });
      return { orderId: order.id, url: link.url };
    } catch (err) {
      await this.prisma.order.delete({ where: { id: order.id } });
      throw err;
    }
  }

  /**
   * One payment attempt for a pending order of the caller's.
   *
   * Every line is checked against the units on hand before Stripe is asked,
   * because the brief says so and because an intent for stock that is gone
   * would charge for a line the webhook then cannot fill. The amount is the
   * order's total, never a caller's number.
   */
  async createPaymentIntent(
    viewer: AccessTokenPayload,
    ability: AppAbility,
    orderId: number,
  ): Promise<PaymentIntentDto> {
    // The rows this caller may pay, from the ability: their own for a client,
    // any for a manager. Another client's order is a 404 by construction.
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, AND: [accessibleBy(ability, 'pay').Order] },
      include: { items: { select: { variantId: true, quantity: true } } },
    });
    if (order === null) {
      throw new NotFoundException();
    }
    if (order.status !== 'pending') {
      throw new ConflictException({
        title: 'Conflict',
        detail: `An order in status ${order.status} cannot be paid.`,
      });
    }

    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: order.items.map((item) => item.variantId) } },
      select: { id: true, stock: true },
    });
    const stockOf = new Map(variants.map((v) => [v.id, v.stock]));
    for (const item of order.items) {
      const stock = stockOf.get(item.variantId) ?? 0;
      if (item.quantity > stock) {
        throw insufficientStock(stock, item.quantity);
      }
    }

    const intent = await this.stripe.createPaymentIntent({
      orderId: order.id,
      amount: order.totalCents,
    });
    this.logger.log({
      msg: 'payment intent created',
      event: 'payment.intent-created',
      orderId: order.id,
      userId: viewer.sub,
      amount: order.totalCents,
    });
    return {
      orderId: order.id,
      clientSecret: intent.clientSecret,
      amount: order.totalCents,
    };
  }

  /** Verify the bytes Stripe sent, then apply what they say. 400 or 200. */
  async receiveEvent(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<void> {
    const event = this.stripe.parseEvent(rawBody, signature);
    await this.applyEvent(event);
  }

  /**
   * Which flow an event belongs to, the order it names, or nothing, and
   * whether money was taken. A session completes `unpaid` when the buyer chose
   * a delayed payment method; the money arrives later, on
   * `checkout.session.async_payment_succeeded`, or never, and this service
   * does not handle that event. A succeeded intent is paid by definition.
   * Found by a hand-written test, 2026-09-02; ADR 24.
   */
  private paymentOf(
    event: Stripe.Event,
  ): { method: PaymentMethod; orderId: number | null; paid: boolean } | null {
    if (event.type === 'checkout.session.completed') {
      return {
        method: 'payment_link',
        orderId: orderIdOf(event.data.object.metadata),
        paid: event.data.object.payment_status === 'paid',
      };
    }
    if (event.type === 'payment_intent.succeeded') {
      return {
        method: 'payment_intent',
        orderId: orderIdOf(event.data.object.metadata),
        paid: true,
      };
    }
    return null;
  }

  /**
   * Apply a verified event. It always resolves: the caller answers 200
   * whatever happened, because anything else makes Stripe retry, and a retry
   * cannot change any of the answers below.
   *
   * The statements, in order: the event id is looked up and then inserted
   * first, so a replay is either seen here or fails the insert as a unique
   * violation and rolls the rest back. Then the order moves to `paid` only if
   * it is still `pending`, in one conditional write, so the other event kind
   * or a cancel that landed first leaves it alone. Then the history row.
   * Then each line's stock comes down, conditional on the units being there;
   * when they are not, the money is already taken, so the stock floors at
   * zero and a warning names the shortfall rather than refusing a payment
   * that happened. The stock of every line before and after is read back,
   * because the low-stock producer decides on the pair and this is the only
   * place it is known; it is handed over after the commit, so a queue outage
   * cannot fail a paid order, and it never throws.
   */
  async applyEvent(event: Stripe.Event): Promise<void> {
    const payment = this.paymentOf(event);
    if (payment === null) {
      this.logger.log({
        msg: 'stripe event ignored',
        event: 'payment.event-ignored',
        stripeEvent: event.id,
        type: event.type,
      });
      return;
    }

    const seen = await this.prisma.stripeEvent.findUnique({
      where: { id: event.id },
      select: { id: true },
    });
    const outcome: Outcome =
      seen !== null
        ? { kind: 'duplicate' }
        : await this.apply(
            event,
            payment.method,
            payment.orderId,
            payment.paid,
          );

    this.report(event, payment.method, outcome);
    if (outcome.kind === 'applied') {
      await this.lowStock.notify(outcome.stocks);
    }
  }

  private async apply(
    event: Stripe.Event,
    method: PaymentMethod,
    orderId: number | null,
    paid: boolean,
  ): Promise<Outcome> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.stripeEvent.create({
          data: { id: event.id, type: event.type },
        });
        if (orderId === null) {
          return { kind: 'orphan', orderId: null };
        }
        // The event is kept, so a replay of it is a duplicate; the order is
        // not touched, because no money arrived.
        if (!paid) {
          return { kind: 'unpaid', orderId };
        }

        const moved = await tx.order.updateMany({
          where: { id: orderId, status: 'pending' },
          data: { status: 'paid', paymentMethod: method },
        });
        if (moved.count === 0) {
          const current = await tx.order.findUnique({
            where: { id: orderId },
            select: { status: true },
          });
          return current === null
            ? { kind: 'orphan', orderId }
            : { kind: 'not-applied', orderId, status: current.status };
        }
        await tx.orderStatusChange.create({
          data: { orderId, status: 'paid' },
        });

        const lines = await tx.orderItem.findMany({
          where: { orderId },
          select: { variantId: true, quantity: true },
        });
        const stocks: StockChange[] = [];
        const oversold: { variantId: number; shortfall: number }[] = [];
        for (const line of lines) {
          const down = await tx.productVariant.updateMany({
            where: { id: line.variantId, stock: { gte: line.quantity } },
            data: { stock: { decrement: line.quantity } },
          });
          if (down.count === 1) {
            const after = await tx.productVariant.findUniqueOrThrow({
              where: { id: line.variantId },
              select: { stock: true },
            });
            // The value before is the value after plus what just came off,
            // and that is one read fewer than reading it first.
            stocks.push({
              variantId: line.variantId,
              before: after.stock + line.quantity,
              after: after.stock,
            });
            continue;
          }
          const before = await tx.productVariant.findUniqueOrThrow({
            where: { id: line.variantId },
            select: { stock: true },
          });
          await tx.productVariant.update({
            where: { id: line.variantId },
            data: { stock: 0 },
          });
          stocks.push({
            variantId: line.variantId,
            before: before.stock,
            after: 0,
          });
          oversold.push({
            variantId: line.variantId,
            shortfall: line.quantity - before.stock,
          });
        }

        return { kind: 'applied', orderId, stocks, oversold };
      });
    } catch (err) {
      // Two deliveries of one event at the same instant: the second insert
      // loses on the primary key and the whole transaction rolls back, which
      // is the replay answer by another route.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return { kind: 'duplicate' };
      }
      throw err;
    }
  }

  private report(
    event: Stripe.Event,
    method: PaymentMethod,
    outcome: Outcome,
  ): void {
    const stripeEvent = event.id;
    switch (outcome.kind) {
      case 'duplicate':
        this.logger.log({
          msg: 'stripe event already applied',
          event: 'payment.duplicate',
          stripeEvent,
        });
        return;
      case 'orphan':
        this.logger.warn({
          msg: 'stripe event names no order',
          event: 'payment.orphan',
          stripeEvent,
          type: event.type,
          orderId: outcome.orderId,
        });
        return;
      case 'unpaid':
        this.logger.warn({
          msg: 'session completed without payment, the order stays pending',
          event: 'payment.unpaid-session',
          stripeEvent,
          orderId: outcome.orderId,
        });
        return;
      case 'not-applied':
        this.logger.warn({
          msg: 'payment arrived for an order that is not pending',
          event: 'payment.not-applied',
          stripeEvent,
          orderId: outcome.orderId,
          status: outcome.status,
        });
        return;
      case 'applied':
        for (const line of outcome.oversold) {
          this.logger.warn({
            msg: 'paid for more units than were on hand',
            event: 'stock.oversold',
            orderId: outcome.orderId,
            variantId: line.variantId,
            shortfall: line.shortfall,
          });
        }
        this.logger.log({
          msg: 'payment applied',
          event: 'payment.applied',
          stripeEvent,
          orderId: outcome.orderId,
          method,
          stocks: outcome.stocks,
        });
    }
  }
}
