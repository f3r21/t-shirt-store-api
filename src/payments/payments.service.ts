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
import {
  CURRENCY,
  STRIPE_MINIMUM_CENTS,
  StripeGateway,
} from './stripe.gateway';
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
      kind: 'amount-mismatch';
      orderId: number;
      amount: number | null;
      currency: string | null;
    }
  | {
      kind: 'applied';
      orderId: number;
      stocks: StockChange[];
      oversold: { variantId: number; shortfall: number }[];
    };

/**
 * What one handled event says: the flow it belongs to, the order it names,
 * whether money was taken, and what was taken. The amount and the currency
 * come off the event object, so both can be absent.
 */
interface Payment {
  method: PaymentMethod;
  orderId: number | null;
  paid: boolean;
  amount: number | null;
  currency: string | null;
}

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
 * The two Stripe flows and the webhook that applies them: one event kind per
 * flow, the event id inserted first, the whole of it one transaction. ADR 24.
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
   * An order for one variant and a Stripe page that sells it. The order is
   * written first, because the link carries its id; if Stripe fails, the
   * order is deleted. Stock is checked and not touched.
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
      // The cleanup must not replace the error that caused it. A row left
      // behind is a warning with its id, and a person removes it.
      try {
        await this.prisma.order.delete({ where: { id: order.id } });
      } catch (cleanup) {
        this.logger.warn({
          msg: 'pending order left behind after a failed link',
          event: 'payment.link-orphan',
          orderId: order.id,
          reason: cleanup instanceof Error ? cleanup.message : String(cleanup),
        });
      }
      throw err;
    }
  }

  /**
   * One payment attempt for a pending order. Every line is checked against
   * the stock first, and the amount is the order's total, never the caller's.
   */
  async createPaymentIntent(
    viewer: AccessTokenPayload,
    ability: AppAbility,
    orderId: number,
  ): Promise<PaymentIntentDto> {
    // The rows this caller may pay, from the ability: another client's order
    // is a 404. ADR 25.
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
    // A promo code can take a total below what the provider will collect, and
    // 0 is only the extreme of it. The bound is the currency's, so it comes
    // from the gateway, and the order is refused here rather than handed to
    // Stripe, which answers a smaller amount with an error nothing maps.
    // ADR 37.
    if (order.totalCents < STRIPE_MINIMUM_CENTS) {
      throw new ConflictException({
        title: 'Conflict',
        detail:
          'The total of this order is below the smallest amount the payment provider accepts.',
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
   * Which flow an event belongs to, the order it names, whether money was
   * taken (a session completes `unpaid` for a delayed payment method), and
   * what was taken: the charged amount in minor units, beside the currency it
   * was charged in, each read off the field its own kind carries it on. An
   * object can arrive without either, so a missing value is `null` and the
   * caller pays nothing for it. ADR 24.
   */
  private paymentOf(event: Stripe.Event): Payment | null {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      return {
        method: 'payment_link',
        orderId: orderIdOf(session.metadata),
        paid: session.payment_status === 'paid',
        amount: session.amount_total ?? null,
        currency: session.currency ?? null,
      };
    }
    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      return {
        method: 'payment_intent',
        orderId: orderIdOf(intent.metadata),
        paid: true,
        amount: intent.amount_received ?? null,
        currency: intent.currency ?? null,
      };
    }
    return null;
  }

  /**
   * Apply a verified event. It always resolves, because Stripe retries
   * anything but 200. The event id first, then the charged amount against the
   * order's total, then one conditional move to `paid`, the history row, then
   * each line's stock, floored at zero with a warning when the units are gone.
   * The stocks go to the low-stock producer after the commit. ADR 24.
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
      seen !== null ? { kind: 'duplicate' } : await this.apply(event, payment);

    this.report(event, payment.method, outcome);
    if (outcome.kind === 'applied') {
      await this.lowStock.notify(outcome.stocks);
    }
  }

  private async apply(event: Stripe.Event, payment: Payment): Promise<Outcome> {
    const { method, orderId, paid, amount, currency } = payment;
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
        // What was taken, against what this store sells in. The endpoint
        // hears every success of the Stripe account, and a valid signature
        // says who sent the body, not which order it belongs to. Another
        // currency, or an object that carries no amount, pays nothing, and
        // the event row stays so a replay is a duplicate.
        if (currency !== CURRENCY || amount === null) {
          return { kind: 'amount-mismatch', orderId, amount, currency };
        }

        const moved = await tx.order.updateMany({
          // The move carries the amount it assumed, so an order that costs
          // something else matches nothing here. ADR 34.
          where: { id: orderId, status: 'pending', totalCents: amount },
          data: { status: 'paid', paymentMethod: method },
        });
        if (moved.count === 0) {
          const current = await tx.order.findUnique({
            where: { id: orderId },
            select: { status: true },
          });
          if (current === null) {
            return { kind: 'orphan', orderId };
          }
          // Zero rows on a row that is still pending: the guard that missed
          // was the total, so what Stripe took is not what this order costs.
          return current.status === 'pending'
            ? { kind: 'amount-mismatch', orderId, amount, currency }
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
          const { change, shortfall } = await this.takeUnits(tx, line);
          stocks.push(change);
          if (shortfall !== null) {
            oversold.push({ variantId: line.variantId, shortfall });
          }
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

  /**
   * Take a line's units off its variant inside the paying transaction: the
   * guarded decrement, else the floor to zero guarded on the stock just read.
   * Zero rows on either means another writer moved the stock in between, so
   * the round starts again, three times at most. ADR 24, ADR 34.
   */
  private async takeUnits(
    tx: Prisma.TransactionClient,
    line: { variantId: number; quantity: number },
  ): Promise<{ change: StockChange; shortfall: number | null }> {
    for (let round = 0; round < 3; round += 1) {
      const down = await tx.productVariant.updateMany({
        where: { id: line.variantId, stock: { gte: line.quantity } },
        data: { stock: { decrement: line.quantity } },
      });
      if (down.count === 1) {
        const after = await tx.productVariant.findUniqueOrThrow({
          where: { id: line.variantId },
          select: { stock: true },
        });
        // The value before is the value after plus what just came off.
        return {
          change: {
            variantId: line.variantId,
            before: after.stock + line.quantity,
            after: after.stock,
          },
          shortfall: null,
        };
      }
      const before = await tx.productVariant.findUniqueOrThrow({
        where: { id: line.variantId },
        select: { stock: true },
      });
      const floored = await tx.productVariant.updateMany({
        where: { id: line.variantId, stock: before.stock },
        data: { stock: 0 },
      });
      if (floored.count === 1) {
        return {
          change: { variantId: line.variantId, before: before.stock, after: 0 },
          shortfall: line.quantity - before.stock,
        };
      }
    }
    throw new Error(
      `The stock of variant ${line.variantId} moved three times during the payment.`,
    );
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
      case 'amount-mismatch':
        this.logger.warn({
          msg: 'payment amount does not match the order',
          event: 'payment.amount-mismatch',
          stripeEvent,
          orderId: outcome.orderId,
          amount: outcome.amount,
          currency: outcome.currency,
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
